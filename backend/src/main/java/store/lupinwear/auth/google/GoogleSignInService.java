package store.lupinwear.auth.google;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.Base64;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.UriComponentsBuilder;
import store.lupinwear.auth.application.AuthService;
import store.lupinwear.auth.application.AuthService.ClientInfo;
import store.lupinwear.auth.application.AuthService.Tokens;
import store.lupinwear.auth.domain.Role;
import store.lupinwear.auth.domain.User;
import store.lupinwear.auth.infra.RoleRepository;
import store.lupinwear.auth.infra.UserRepository;

/**
 * "Continue with Google" with the authorization-code flow, PKCE and a one-time state. A Google
 * account is matched by its permanent Google ID; the first time, by its verified email, so an
 * existing customer keeps their orders. Staff accounts sign in with their password only: a Google
 * account must never become a way into the dashboard.
 */
@Service
public class GoogleSignInService {

    private static final Logger log = LoggerFactory.getLogger(GoogleSignInService.class);
    private static final String AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

    /** Why sign-in did not finish; the sign-in page shows a matching message. */
    public enum Failure { UNAVAILABLE, CANCELLED, FAILED, UNVERIFIED, STAFF, DISABLED }

    public static class GoogleSignInException extends RuntimeException {
        private final Failure failure;

        GoogleSignInException(Failure failure) {
            super(failure.name());
            this.failure = failure;
        }

        public Failure failure() {
            return failure;
        }
    }

    /** What the browser keeps (in a short-lived HttpOnly cookie) between leaving for Google and coming back. */
    public record Pending(String state, String verifier) {
    }

    private final GoogleProperties props;
    private final GoogleGateway google;
    private final UserRepository users;
    private final RoleRepository roles;
    private final AuthService auth;
    private final JdbcClient jdbc;
    private final Clock clock;
    private final String publicBaseUrl;
    private final SecureRandom random = new SecureRandom();

    public GoogleSignInService(GoogleProperties props, GoogleGateway google, UserRepository users, RoleRepository roles,
            AuthService auth, JdbcClient jdbc, Clock clock, @Value("${lupin.public-base-url}") String publicBaseUrl) {
        this.props = props;
        this.google = google;
        this.users = users;
        this.roles = roles;
        this.auth = auth;
        this.jdbc = jdbc;
        this.clock = clock;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    public boolean enabled() {
        return props.configured();
    }

    public String redirectUri() {
        return publicBaseUrl + "/api/v1/auth/google/callback";
    }

    public Pending newPending() {
        return new Pending(randomToken(), randomToken());
    }

    /** Google's sign-in page for this attempt. */
    public String authorizationUrl(Pending pending, String lang) {
        if (!enabled()) {
            throw new GoogleSignInException(Failure.UNAVAILABLE);
        }
        return UriComponentsBuilder.fromUriString(AUTH_URL)
                .queryParam("client_id", props.clientId())
                .queryParam("redirect_uri", redirectUri())
                .queryParam("response_type", "code")
                .queryParam("scope", "openid email profile")
                .queryParam("state", pending.state())
                .queryParam("code_challenge", challenge(pending.verifier()))
                .queryParam("code_challenge_method", "S256")
                .queryParam("prompt", "select_account")
                .queryParam("hl", "ar".equals(lang) ? "ar" : "en")
                .build().encode().toUriString();
    }

    @Transactional
    public Tokens complete(Pending pending, String state, String code, String error, String lang, ClientInfo client) {
        if (!enabled()) {
            throw new GoogleSignInException(Failure.UNAVAILABLE);
        }
        if (error != null) {
            throw new GoogleSignInException(Failure.CANCELLED);
        }
        if (pending == null || state == null || code == null
                || !MessageDigest.isEqual(pending.state().getBytes(StandardCharsets.UTF_8), state.getBytes(StandardCharsets.UTF_8))) {
            throw new GoogleSignInException(Failure.FAILED);
        }
        GoogleGateway.Profile profile;
        try {
            profile = google.exchange(code, pending.verifier(), redirectUri());
        } catch (RuntimeException e) {
            log.warn("Google sign-in: code exchange failed: {}", e.getMessage());
            throw new GoogleSignInException(Failure.FAILED);
        }
        if (profile.subject() == null || profile.subject().isBlank()) {
            throw new GoogleSignInException(Failure.FAILED);
        }
        User user = linkedUser(profile.subject()).orElse(null);
        if (user == null) {
            if (profile.email() == null || !profile.emailVerified()) {
                throw new GoogleSignInException(Failure.UNVERIFIED);
            }
            String email = profile.email().trim().toLowerCase(Locale.ROOT);
            user = users.findByEmail(email).orElse(null);
            if (user == null) {
                user = new User(email, null, null, displayName(profile, email), "ar".equals(lang) ? "ar" : "en");
                user.grant(roles.findByCode(Role.CUSTOMER).orElseThrow());
                user = users.saveAndFlush(user);
            } else if (isStaff(user)) {
                throw new GoogleSignInException(Failure.STAFF);
            }
            jdbc.sql("insert into oauth_identities (user_id, provider, subject) values (:user, 'GOOGLE', :sub)")
                    .param("user", user.getId()).param("sub", profile.subject()).update();
        }
        if (isStaff(user)) {
            throw new GoogleSignInException(Failure.STAFF);
        }
        if (!user.canSignIn()) {
            throw new GoogleSignInException(Failure.DISABLED);
        }
        if (profile.emailVerified() && user.getEmail() != null && user.getEmail().equalsIgnoreCase(profile.email())) {
            user.markEmailVerified(clock.instant());
        }
        return auth.signInVerified(user, client);
    }

    private Optional<User> linkedUser(String subject) {
        return jdbc.sql("select user_id from oauth_identities where provider = 'GOOGLE' and subject = :sub")
                .param("sub", subject).query(UUID.class).optional().flatMap(users::findById);
    }

    private static boolean isStaff(User user) {
        return user.roleCodes().contains(Role.ADMIN) || user.roleCodes().contains(Role.OWNER);
    }

    private static String displayName(GoogleGateway.Profile profile, String email) {
        String name = profile.name() == null ? "" : profile.name().trim();
        if (name.length() < 2) {
            name = email.substring(0, email.indexOf('@'));
        }
        return name.length() > 120 ? name.substring(0, 120) : name;
    }

    private String randomToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String challenge(String verifier) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
