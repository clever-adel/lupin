package store.lupinwear.auth.application;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import store.lupinwear.auth.api.AuthDtos.LoginRequest;
import store.lupinwear.auth.api.AuthDtos.RegisterRequest;
import store.lupinwear.auth.domain.AuthSession;
import store.lupinwear.auth.domain.Role;
import store.lupinwear.auth.domain.User;
import store.lupinwear.auth.infra.AuthSessionRepository;
import store.lupinwear.auth.infra.RoleRepository;
import store.lupinwear.auth.infra.UserRepository;
import store.lupinwear.security.JwtService;
import store.lupinwear.security.RateLimiter;
import store.lupinwear.security.SecurityProperties;
import store.lupinwear.shared.ApiException;

@Service
public class AuthService {

    /** Two tabs refreshing at once is normal; only a replay after this window is treated as theft. */
    private static final Duration ROTATION_GRACE = Duration.ofSeconds(10);
    private static final Duration MAX_LOCKOUT = Duration.ofHours(24);

    public record Tokens(User user, String accessToken, String refreshToken) {
    }

    public record ClientInfo(String ip, String userAgent) {
    }

    private final UserRepository users;
    private final RoleRepository roles;
    private final AuthSessionRepository sessions;
    private final PasswordEncoder passwords;
    private final JwtService jwt;
    private final RateLimiter rateLimiter;
    private final SecurityProperties props;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();
    /** Verified against when the email is unknown, so both paths cost the same time. */
    private final String dummyHash;

    public AuthService(UserRepository users, RoleRepository roles, AuthSessionRepository sessions,
            PasswordEncoder passwords, JwtService jwt, RateLimiter rateLimiter, SecurityProperties props,
            Clock clock) {
        this.users = users;
        this.roles = roles;
        this.sessions = sessions;
        this.passwords = passwords;
        this.jwt = jwt;
        this.rateLimiter = rateLimiter;
        this.props = props;
        this.clock = clock;
        this.dummyHash = passwords.encode(UUID.randomUUID().toString());
    }

    @Transactional
    public Tokens register(RegisterRequest req, ClientInfo client) {
        rateLimiter.check("register:ip:" + client.ip(), 10);
        String email = normalizeEmail(req.email());
        if (req.password().toLowerCase(Locale.ROOT).contains(email.substring(0, email.indexOf('@')))
                && email.indexOf('@') >= 4) {
            throw ApiException.badRequest("WEAK_PASSWORD", "Your password should not contain your email.");
        }
        if (users.existsByEmail(email)) {
            throw ApiException.conflict("EMAIL_TAKEN", "An account with this email already exists. Sign in instead.");
        }
        if (req.phone() != null && users.existsByPhone(req.phone())) {
            throw ApiException.conflict("PHONE_TAKEN", "An account with this mobile number already exists.");
        }
        User user = new User(email, req.phone(), passwords.encode(req.password()), req.fullName().trim(),
                req.lang() == null ? "en" : req.lang());
        user.grant(role(Role.CUSTOMER));
        users.save(user);
        return startSession(user, UUID.randomUUID(), client);
    }

    /** Failed attempts must be persisted even though the call ends in an exception. */
    @Transactional(noRollbackFor = ApiException.class)
    public Tokens login(LoginRequest req, ClientInfo client) {
        String email = normalizeEmail(req.email());
        rateLimiter.check("login:ip:" + client.ip(), 30);
        rateLimiter.check("login:id:" + email, 10);

        Instant now = clock.instant();
        User user = users.findByEmail(email).filter(User::canSignIn).orElse(null);
        if (user == null || user.getPasswordHash() == null) {
            passwords.matches(req.password(), dummyHash);
            throw invalidCredentials();
        }
        if (user.isLocked(now)) {
            // Same answer as a wrong password: the response must not reveal that the account exists.
            passwords.matches(req.password(), dummyHash);
            throw invalidCredentials();
        }
        if (!passwords.matches(req.password(), user.getPasswordHash())) {
            users.incrementFailedLogins(user.getId());
            User fresh = users.findById(user.getId()).orElseThrow();
            int over = fresh.getFailedLoginCount() - props.maxFailedLogins();
            if (over >= 0) {
                Duration lock = props.lockoutBase().multipliedBy(1L << Math.min(over, 10));
                fresh.lockUntil(now.plus(lock.compareTo(MAX_LOCKOUT) > 0 ? MAX_LOCKOUT : lock));
            }
            throw invalidCredentials();
        }
        user.recordSuccessfulLogin(now);
        return startSession(user, UUID.randomUUID(), client);
    }

    @Transactional(noRollbackFor = ApiException.class)
    public Tokens refresh(String refreshToken, ClientInfo client) {
        Instant now = clock.instant();
        AuthSession session = sessions.findByTokenHash(sha256(refreshToken)).orElseThrow(AuthService::sessionExpired);
        if (session.getRevokedAt() != null || session.getExpiresAt().isBefore(now)) {
            throw sessionExpired();
        }
        if (sessions.markRotated(session.getId(), now) == 0) {
            Instant rotatedAt = sessions.findById(session.getId()).map(AuthSession::getRotatedAt).orElse(null);
            if (rotatedAt == null || rotatedAt.plus(ROTATION_GRACE).isBefore(now)) {
                // An already-used refresh token came back: assume it was stolen and end every session in the family.
                sessions.revokeFamily(session.getFamilyId(), now);
            }
            throw sessionExpired();
        }
        User user = users.findById(session.getUserId()).filter(User::canSignIn).orElseThrow(AuthService::sessionExpired);
        return startSession(user, session.getFamilyId(), client);
    }

    @Transactional
    public void logout(String refreshToken) {
        if (refreshToken == null) {
            return;
        }
        sessions.findByTokenHash(sha256(refreshToken))
                .ifPresent(s -> sessions.revokeFamily(s.getFamilyId(), clock.instant()));
    }

    @Transactional
    public void logoutEverywhere(UUID userId) {
        sessions.revokeAllForUser(userId, clock.instant());
    }

    @Transactional(readOnly = true)
    public User me(UUID userId) {
        return users.findById(userId).filter(User::canSignIn)
                .orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in."));
    }

    /**
     * A signed-in person changes their own password. Every session of theirs ends, including this
     * one, so they sign in again with the new password and a stolen session stops working.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public void changeOwnPassword(UUID userId, String current, String next) {
        rateLimiter.check("password:" + userId, 10);
        User user = users.findById(userId).filter(User::canSignIn)
                .orElseThrow(() -> ApiException.unauthorized("UNAUTHENTICATED", "Please sign in."));
        if (user.getPasswordHash() == null || !passwords.matches(current, user.getPasswordHash())) {
            throw ApiException.badRequest("WRONG_PASSWORD", "Your current password is not correct.");
        }
        boolean staff = user.roleCodes().contains(Role.ADMIN) || user.roleCodes().contains(Role.OWNER);
        if (staff && next.length() < 12) {
            throw ApiException.badRequest("WEAK_PASSWORD", "Staff passwords need at least 12 characters.");
        }
        if (passwords.matches(next, user.getPasswordHash())) {
            throw ApiException.badRequest("SAME_PASSWORD", "Choose a password you have not just been using.");
        }
        user.changePassword(passwords.encode(next));
        // Written now: the session update below clears pending changes that have not been flushed.
        users.saveAndFlush(user);
        sessions.revokeAllForUser(userId, clock.instant());
    }

    /** An owner sets a new password for a staff member who is locked out. Ends that person's sessions. */
    @Transactional
    public void resetStaffPassword(UUID staffId, String next) {
        if (next.length() < 12) {
            throw ApiException.badRequest("WEAK_PASSWORD", "Staff passwords need at least 12 characters.");
        }
        User user = users.findById(staffId).orElseThrow(() -> ApiException.notFound("Staff member"));
        user.changePassword(passwords.encode(next));
        users.saveAndFlush(user);
        sessions.revokeAllForUser(staffId, clock.instant());
    }

    /** Creates a staff account. Used by the owner bootstrap and by staff management. */
    @Transactional
    public User createStaff(String email, String rawPassword, String fullName, String roleCode) {
        if (rawPassword.length() < 12) {
            throw ApiException.badRequest("WEAK_PASSWORD", "Staff passwords need at least 12 characters.");
        }
        if (users.existsByEmail(normalizeEmail(email))) {
            throw ApiException.conflict("EMAIL_TAKEN", "An account with this email already exists.");
        }
        User user = new User(normalizeEmail(email), null, passwords.encode(rawPassword), fullName, "en");
        user.grant(role(roleCode));
        return users.save(user);
    }

    private Tokens startSession(User user, UUID familyId, ClientInfo client) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String refresh = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        String agent = client.userAgent() == null ? null
                : client.userAgent().substring(0, Math.min(300, client.userAgent().length()));
        sessions.save(new AuthSession(user.getId(), familyId, sha256(refresh),
                clock.instant().plus(props.refreshTokenTtl()), agent, client.ip()));
        return new Tokens(user, jwt.issueAccessToken(user.getId(), user.roleCodes()), refresh);
    }

    private Role role(String code) {
        return roles.findByCode(code).orElseThrow(() -> new IllegalStateException("Missing role " + code));
    }

    static String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static ApiException invalidCredentials() {
        return ApiException.unauthorized("INVALID_CREDENTIALS", "Email or password is not correct.");
    }

    private static ApiException sessionExpired() {
        return ApiException.unauthorized("SESSION_EXPIRED", "Your session has ended. Please sign in again.");
    }
}
