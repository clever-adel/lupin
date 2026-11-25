package store.lupinwear.auth.mfa;

import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.Set;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import store.lupinwear.auth.domain.Role;
import store.lupinwear.security.JwtService;
import store.lupinwear.security.RateLimiter;
import store.lupinwear.security.SecurityProperties;
import store.lupinwear.shared.ApiException;

/**
 * Two-step sign-in for staff: after the password, a 6-digit code from an authenticator app (Google
 * Authenticator, Microsoft Authenticator, Authy…), or one of ten single-use recovery codes.
 *
 * Every owner and admin must switch it on: until they do, the dashboard's API answers MFA_REQUIRED
 * and the dashboard shows the pairing screen instead. Customers are not affected.
 *
 * The app's key is stored encrypted with AES-GCM under a key derived from LUPIN_MFA_SECRET (or, when that
 * is not set, from LUPIN_JWT_SECRET), so a copy of the database alone does not reveal it. Changing that
 * secret means every staff member pairs their app again (an owner resets them from the Staff screen).
 */
@Service
public class TwoFactorService {

    /** What the dashboard should do for this signed-in person. Null for customers. */
    public enum State {
        /** Two-step sign-in is on and this sign-in passed it. */
        ON,
        /** Not switched on yet: the dashboard shows the pairing screen. */
        SETUP,
        /** Switched on, but this sign-in did not pass it (an older sign-in): sign in again. */
        SIGN_IN_AGAIN
    }

    public record Pairing(String secret, String uri) {
    }

    public record Status(boolean enabled, boolean thisSignInVerified, int recoveryCodesLeft) {
    }

    private static final int RECOVERY_CODES = 10;
    /** No 0/o, 1/l/i: easy to copy from paper. */
    private static final char[] RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789".toCharArray();
    private static final String ISSUER = "LUPIN";
    private static final String KEY_PURPOSE = "lupin-staff-totp-v1";

    private final JdbcClient jdbc;
    private final RateLimiter rateLimiter;
    private final Clock clock;
    private final SecretKeySpec storageKey;
    private final SecureRandom random = new SecureRandom();

    public TwoFactorService(JdbcClient jdbc, RateLimiter rateLimiter, Clock clock, JwtService jwt,
            SecurityProperties props) {
        this.jdbc = jdbc;
        this.rateLimiter = rateLimiter;
        this.clock = clock;
        String own = props.mfaSecret() == null ? "" : props.mfaSecret().trim();
        if (!own.isEmpty() && own.length() < 32) {
            throw new IllegalStateException("LUPIN_MFA_SECRET must be at least 32 characters when set.");
        }
        byte[] key = own.isEmpty() ? jwt.deriveKey(KEY_PURPOSE) : hmac(own.getBytes(StandardCharsets.UTF_8), KEY_PURPOSE);
        this.storageKey = new SecretKeySpec(key, "AES");
    }

    private static byte[] hmac(byte[] secret, String purpose) {
        try {
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return mac.doFinal(purpose.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    public static boolean isStaff(Set<String> roles) {
        return roles.contains(Role.ADMIN) || roles.contains(Role.OWNER);
    }

    @Transactional(readOnly = true)
    public boolean enabled(UUID user) {
        return jdbc.sql("select totp_enabled_at is not null from users where id = :u").param("u", user)
                .query(Boolean.class).optional().orElse(false);
    }

    @Transactional(readOnly = true)
    public State state(UUID user, Set<String> roles, UUID family) {
        if (!isStaff(roles)) {
            return null;
        }
        // A sign-in that was ended (password reset, switched off, two-step reset) keeps a valid-looking
        // access token for a few minutes; it must not be offered pairing or anything else.
        if (!liveSignIn(user, family)) {
            return State.SIGN_IN_AGAIN;
        }
        if (!enabled(user)) {
            return State.SETUP;
        }
        return verifiedSignIn(user, family) ? State.ON : State.SIGN_IN_AGAIN;
    }

    @Transactional(readOnly = true)
    public Status status(UUID user, UUID family) {
        int left = jdbc.sql("select count(*) from staff_recovery_codes where user_id = :u and used_at is null")
                .param("u", user).query(Integer.class).single();
        boolean on = enabled(user);
        return new Status(on, on && verifiedSignIn(user, family), left);
    }

    /**
     * Starts pairing: a new key for the app, shown once as a QR code and as text. Asking again replaces
     * it, so a half-finished pairing is simply started over. Not possible once two-step sign-in is on.
     */
    @Transactional
    public Pairing beginSetup(UUID user, UUID family) {
        rateLimiter.check("mfa-setup:" + user, 20);
        if (!liveSignIn(user, family)) {
            throw signInAgain();
        }
        record Row(String email, boolean on) {
        }
        Row row = jdbc.sql("select email, totp_enabled_at is not null from users where id = :u").param("u", user)
                .query((rs, n) -> new Row(rs.getString(1), rs.getBoolean(2))).optional()
                .orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in."));
        if (row.on()) {
            throw ApiException.conflict("MFA_ALREADY_ON", "Two-step sign-in is already on for this account.");
        }
        byte[] secret = Totp.newSecret();
        jdbc.sql("update users set totp_secret = :s, totp_last_step = null, updated_at = now() where id = :u")
                .param("s", encrypt(secret)).param("u", user).update();
        String key = Totp.base32(secret);
        String label = encode(ISSUER + ":" + (row.email() == null ? "staff" : row.email()));
        String uri = "otpauth://totp/" + label + "?secret=" + key + "&issuer=" + encode(ISSUER)
                + "&algorithm=SHA1&digits=6&period=" + Totp.PERIOD_SECONDS;
        return new Pairing(key, uri);
    }

    /**
     * Finishes pairing with the first code from the app. Marks this sign-in as verified, ends every other
     * sign-in of the account (they never passed the second step), and returns the recovery codes, shown once.
     */
    @Transactional
    public List<String> enable(UUID user, UUID family, String code) {
        rateLimiter.check("mfa-enable:" + user, 10);
        if (family == null) {
            throw signInAgain();
        }
        record Row(String secret, boolean on) {
        }
        Row row = jdbc.sql("select totp_secret, totp_enabled_at is not null from users where id = :u for update")
                .param("u", user).query((rs, n) -> new Row(rs.getString(1), rs.getBoolean(2))).optional()
                .orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in."));
        if (row.on()) {
            throw ApiException.conflict("MFA_ALREADY_ON", "Two-step sign-in is already on for this account.");
        }
        if (row.secret() == null) {
            throw ApiException.badRequest("MFA_NOT_STARTED", "Start again: scan the new QR code first.");
        }
        OptionalLong step = Totp.matchingStep(decrypt(row.secret()), normalizeTotp(code), clock.instant());
        if (step.isEmpty()) {
            throw wrongCode();
        }
        jdbc.sql("update users set totp_enabled_at = :now, totp_last_step = :step, updated_at = now() where id = :u")
                .param("now", Timestamp.from(clock.instant())).param("step", step.getAsLong()).param("u", user).update();
        int live = jdbc.sql("""
                update auth_sessions set mfa_at = :now
                where user_id = :u and family_id = :f and revoked_at is null and expires_at > :now
                """).param("now", Timestamp.from(clock.instant())).param("u", user).param("f", family).update();
        if (live == 0) {
            throw signInAgain();
        }
        jdbc.sql("update auth_sessions set revoked_at = :now where user_id = :u and family_id <> :f and revoked_at is null")
                .param("now", Timestamp.from(clock.instant())).param("u", user).param("f", family).update();
        return replaceRecoveryCodes(user);
    }

    /** Fresh recovery codes (the old ones stop working). Needs a current app code and a verified sign-in. */
    @Transactional
    public List<String> newRecoveryCodes(UUID user, UUID family, String code) {
        rateLimiter.check("mfa-codes:" + user, 10);
        if (!enabled(user) || !verifiedSignIn(user, family)) {
            throw signInAgain();
        }
        if (!checkAppCode(user, normalizeTotp(code))) {
            throw wrongCode();
        }
        return replaceRecoveryCodes(user);
    }

    /**
     * The second step of signing in: an app code (each accepted once only) or an unused recovery code.
     * The caller counts failures towards the account lockout.
     */
    @Transactional
    public boolean checkSignInCode(UUID user, String code) {
        if (code == null) {
            return false;
        }
        String totp = normalizeTotp(code);
        if (totp.length() == 6 && totp.chars().allMatch(Character::isDigit)) {
            return checkAppCode(user, totp);
        }
        String recovery = normalizeRecovery(code);
        if (recovery.length() != 10) {
            return false;
        }
        return jdbc.sql("""
                update staff_recovery_codes set used_at = :now
                where id = (select id from staff_recovery_codes
                            where user_id = :u and code_hash = :h and used_at is null limit 1)
                """).param("now", Timestamp.from(clock.instant())).param("u", user).param("h", sha256(recovery))
                .update() == 1;
    }

    /** Owner action for a staff member who lost their phone: off again, every session ended, pair again at next sign-in. */
    @Transactional
    public void reset(UUID user) {
        jdbc.sql("""
                update users set totp_secret = null, totp_enabled_at = null, totp_last_step = null, updated_at = now()
                where id = :u
                """).param("u", user).update();
        jdbc.sql("delete from staff_recovery_codes where user_id = :u").param("u", user).update();
        jdbc.sql("update auth_sessions set revoked_at = :now where user_id = :u and revoked_at is null")
                .param("now", Timestamp.from(clock.instant())).param("u", user).update();
    }

    private boolean checkAppCode(UUID user, String code) {
        Optional<String> stored = jdbc.sql("select totp_secret from users where id = :u and totp_enabled_at is not null")
                .param("u", user).query(String.class).optional();
        if (stored.isEmpty()) {
            return false;
        }
        OptionalLong step = Totp.matchingStep(decrypt(stored.get()), code, clock.instant());
        // The step only moves forward, so a code that was already used (seen over a shoulder) is refused.
        return step.isPresent() && jdbc.sql("""
                update users set totp_last_step = :step
                where id = :u and (totp_last_step is null or totp_last_step < :step)
                """).param("step", step.getAsLong()).param("u", user).update() == 1;
    }

    private boolean liveSignIn(UUID user, UUID family) {
        return family != null && jdbc.sql("""
                select exists (select 1 from auth_sessions
                               where user_id = :u and family_id = :f and revoked_at is null and expires_at > :now)
                """).param("u", user).param("f", family).param("now", Timestamp.from(clock.instant()))
                .query(Boolean.class).single();
    }

    private boolean verifiedSignIn(UUID user, UUID family) {
        return family != null && jdbc.sql("""
                select exists (select 1 from auth_sessions
                               where user_id = :u and family_id = :f and mfa_at is not null
                                 and revoked_at is null and expires_at > :now)
                """).param("u", user).param("f", family).param("now", Timestamp.from(clock.instant()))
                .query(Boolean.class).single();
    }

    private List<String> replaceRecoveryCodes(UUID user) {
        jdbc.sql("delete from staff_recovery_codes where user_id = :u").param("u", user).update();
        List<String> codes = new ArrayList<>();
        for (int i = 0; i < RECOVERY_CODES; i++) {
            StringBuilder code = new StringBuilder();
            for (int c = 0; c < 10; c++) {
                code.append(RECOVERY_ALPHABET[random.nextInt(RECOVERY_ALPHABET.length)]);
            }
            jdbc.sql("insert into staff_recovery_codes (user_id, code_hash) values (:u, :h)")
                    .param("u", user).param("h", sha256(code.toString())).update();
            codes.add(code.substring(0, 5) + "-" + code.substring(5));
        }
        return codes;
    }

    private String encrypt(byte[] secret) {
        try {
            byte[] iv = new byte[12];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, storageKey, new GCMParameterSpec(128, iv));
            byte[] sealed = cipher.doFinal(secret);
            return "v1." + Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(ByteBuffer.allocate(iv.length + sealed.length).put(iv).put(sealed).array());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private byte[] decrypt(String stored) {
        try {
            if (!stored.startsWith("v1.")) {
                throw new IllegalStateException("Unknown two-step key format");
            }
            byte[] all = Base64.getUrlDecoder().decode(stored.substring(3));
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, storageKey, new GCMParameterSpec(128, all, 0, 12));
            return cipher.doFinal(all, 12, all.length - 12);
        } catch (GeneralSecurityException e) {
            // Most likely the secret changed since pairing: an owner must reset this person's two-step sign-in.
            throw new IllegalStateException("Two-step key cannot be read; was LUPIN_MFA_SECRET (or LUPIN_JWT_SECRET) changed?", e);
        }
    }

    private static String normalizeTotp(String code) {
        return code == null ? "" : code.replaceAll("\\s", "");
    }

    private static String normalizeRecovery(String code) {
        return code.replaceAll("[\\s-]", "").toLowerCase(Locale.ROOT);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static ApiException wrongCode() {
        return ApiException.badRequest("MFA_CODE_WRONG", "That code is not right. Use the newest code in the app.");
    }

    private static ApiException signInAgain() {
        return ApiException.unauthorized("SESSION_EXPIRED", "Your session has ended. Please sign in again.");
    }
}
