package store.lupinwear.auth.application;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.util.HtmlUtils;
import store.lupinwear.auth.domain.Role;
import store.lupinwear.auth.domain.User;
import store.lupinwear.auth.infra.AuthSessionRepository;
import store.lupinwear.auth.infra.UserRepository;
import store.lupinwear.mail.Mailer;
import store.lupinwear.security.RateLimiter;
import store.lupinwear.shared.ApiException;

/**
 * "Forgot password": a one-time link by email, valid for one hour. The answer to the request is the
 * same whether or not the email has an account, and the email is sent after the response (on a
 * separate thread), so neither the reply nor its timing tells a stranger who has an account here.
 */
@Service
public class PasswordResetService {

    static final Duration LINK_TTL = Duration.ofHours(1);

    private final UserRepository users;
    private final AuthSessionRepository sessions;
    private final PasswordEncoder passwords;
    private final JdbcClient jdbc;
    private final Mailer mailer;
    private final RateLimiter rateLimiter;
    private final Clock clock;
    private final String publicBaseUrl;
    private final SecureRandom random = new SecureRandom();

    public PasswordResetService(UserRepository users, AuthSessionRepository sessions, PasswordEncoder passwords,
            JdbcClient jdbc, Mailer mailer, RateLimiter rateLimiter, Clock clock,
            @Value("${lupin.public-base-url}") String publicBaseUrl) {
        this.users = users;
        this.sessions = sessions;
        this.passwords = passwords;
        this.jdbc = jdbc;
        this.mailer = mailer;
        this.rateLimiter = rateLimiter;
        this.clock = clock;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    @Transactional
    public void requestLink(String rawEmail, String lang, String ip) {
        String email = AuthService.normalizeEmail(rawEmail);
        rateLimiter.check("reset:ip:" + ip, 10);
        rateLimiter.check("reset:id:" + email, 3);
        User user = users.findByEmail(email).filter(User::canSignIn).orElse(null);
        if (user == null) {
            return;
        }
        Instant now = clock.instant();
        // Only the newest link works.
        jdbc.sql("update password_reset_tokens set used_at = :now where user_id = :user and used_at is null")
                .param("now", java.sql.Timestamp.from(now)).param("user", user.getId()).update();
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        jdbc.sql("insert into password_reset_tokens (user_id, token_hash, expires_at) values (:user, :hash, :expires)")
                .param("user", user.getId()).param("hash", AuthService.sha256(token))
                .param("expires", java.sql.Timestamp.from(now.plus(LINK_TTL))).update();

        boolean arabic = "ar".equals(lang) || (lang == null && "ar".equals(user.getPreferredLang()));
        // The token travels after "#": browsers never send that part to a server or in a Referer.
        String link = publicBaseUrl + (arabic ? "/ar" : "") + "/reset-password#token=" + token;
        Mailer.Message message = message(user.getEmail(), user.getFullName(), link, arabic);
        Runnable send = () -> Thread.ofVirtual().name("reset-mail").start(() -> mailer.send(message));
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    send.run();
                }
            });
        } else {
            send.run();
        }
    }

    /** Sets the new password, ends every session of that person and uses the link up. */
    @Transactional
    public void reset(String token, String next, String ip) {
        rateLimiter.check("reset-use:ip:" + ip, 20);
        Instant now = clock.instant();
        UUID userId = jdbc.sql("""
                        update password_reset_tokens set used_at = :now
                        where token_hash = :hash and used_at is null and expires_at > :now
                        returning user_id""")
                .param("now", java.sql.Timestamp.from(now)).param("hash", AuthService.sha256(token))
                .query(UUID.class).optional().orElseThrow(PasswordResetService::invalidLink);
        User user = users.findById(userId).filter(User::canSignIn).orElseThrow(PasswordResetService::invalidLink);
        boolean staff = user.roleCodes().contains(Role.ADMIN) || user.roleCodes().contains(Role.OWNER);
        if (staff && next.length() < 12) {
            // Rolls back, so the link still works: the person only needs to pick a longer password.
            throw ApiException.badRequest("WEAK_PASSWORD", "Staff passwords need at least 12 characters.");
        }
        user.changePassword(passwords.encode(next));
        users.saveAndFlush(user);
        sessions.revokeAllForUser(userId, now);
    }

    private static ApiException invalidLink() {
        return ApiException.badRequest("RESET_LINK_INVALID",
                "This link has expired or was already used. Ask for a new one.");
    }

    static Mailer.Message message(String to, String fullName, String link, boolean arabic) {
        String first = fullName == null ? "" : fullName.trim().split("\\s+")[0];
        String name = HtmlUtils.htmlEscape(first);
        String href = HtmlUtils.htmlEscape(link);
        if (arabic) {
            String subject = "إعادة تعيين كلمة السر — LUPIN";
            String text = "أهلاً " + first + "،\n\nطلبت تغيير كلمة السر لحسابك في LUPIN. افتح اللينك ده واختار كلمة سر جديدة:\n"
                    + link + "\n\nاللينك شغال ساعة واحدة ولمرة واحدة بس. لو مش إنت اللي طلبت، تجاهل الرسالة دي وكلمة السر هتفضل زي ما هي.";
            String html = page("rtl", "أهلاً " + name + "،",
                    "طلبت تغيير كلمة السر لحسابك في LUPIN. دوس على الزرار واختار كلمة سر جديدة.",
                    href, "اختار كلمة سر جديدة",
                    "اللينك شغال ساعة واحدة ولمرة واحدة بس. لو مش إنت اللي طلبت، تجاهل الرسالة دي وكلمة السر هتفضل زي ما هي.");
            return new Mailer.Message(to, subject, text, html);
        }
        String subject = "Reset your LUPIN password";
        String text = "Hi " + first + ",\n\nYou asked to reset the password of your LUPIN account. Open this link to choose a new one:\n"
                + link + "\n\nThe link works once, for one hour. If you did not ask for this, ignore this email; your password stays the same.";
        String html = page("ltr", "Hi " + name + ",",
                "You asked to reset the password of your LUPIN account. Use the button to choose a new one.",
                href, "Choose a new password",
                "The link works once, for one hour. If you did not ask for this, ignore this email; your password stays the same.");
        return new Mailer.Message(to, subject, text, html);
    }

    private static String page(String dir, String hello, String body, String href, String button, String note) {
        return """
                <!doctype html><html dir="%s"><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#111">
                <table role="presentation" width="100%%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
                <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border:1px solid #e3ded3">
                <tr><td style="background:#111;color:#f4f1ea;padding:20px 28px;font-size:18px;letter-spacing:.35em;font-weight:bold">LUPIN.</td></tr>
                <tr><td style="padding:28px">
                <p style="margin:0 0 12px;font-size:16px;font-weight:bold">%s</p>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.6">%s</p>
                <a href="%s" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 22px;font-size:13px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase">%s</a>
                <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#6b675f">%s</p>
                </td></tr></table></td></tr></table></body></html>""".formatted(dir, hello, body, href, button, note);
    }
}
