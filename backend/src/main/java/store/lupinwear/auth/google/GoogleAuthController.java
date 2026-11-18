package store.lupinwear.auth.google;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.auth.application.AuthService.ClientInfo;
import store.lupinwear.auth.application.AuthService.Tokens;
import store.lupinwear.auth.google.GoogleSignInService.GoogleSignInException;
import store.lupinwear.auth.google.GoogleSignInService.Pending;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.security.SecurityProperties;

/**
 * Plain browser navigations (not fetch calls): /start sends the visitor to Google, Google sends them
 * back to /callback, and /callback signs them in and sends them on into the store. Every answer is
 * a redirect to a page on this site; a failure lands on the sign-in page with a reason.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class GoogleAuthController {

    static final String PENDING_COOKIE = "lw_g";
    private static final String PENDING_PATH = "/api/v1/auth/google";

    private final GoogleSignInService google;
    private final AuthCookies cookies;
    private final SecurityProperties security;

    public GoogleAuthController(GoogleSignInService google, AuthCookies cookies, SecurityProperties security) {
        this.google = google;
        this.cookies = cookies;
        this.security = security;
    }

    /** Which extra sign-in methods the sign-in page should offer. */
    @GetMapping("/providers")
    Map<String, Boolean> providers() {
        return Map.of("google", google.enabled());
    }

    @GetMapping("/google/start")
    void start(@RequestParam(required = false) String lang, @RequestParam(required = false) String next,
            HttpServletResponse res) {
        String language = "ar".equals(lang) ? "ar" : "en";
        if (!google.enabled()) {
            redirect(res, failurePage(language, GoogleSignInService.Failure.UNAVAILABLE));
            return;
        }
        Pending pending = google.newPending();
        String safe = safeNext(next);
        String value = String.join(".", pending.state(), pending.verifier(), language,
                safe == null ? "" : Base64.getUrlEncoder().withoutPadding().encodeToString(safe.getBytes(StandardCharsets.UTF_8)));
        setPending(res, value, Duration.ofMinutes(10));
        redirect(res, google.authorizationUrl(pending, language));
    }

    @GetMapping("/google/callback")
    void callback(@RequestParam(required = false) String state, @RequestParam(required = false) String code,
            @RequestParam(required = false) String error, HttpServletRequest req, HttpServletResponse res) {
        String[] parts = AuthCookies.read(req, PENDING_COOKIE).map(v -> v.split("\\.", -1)).orElse(new String[0]);
        setPending(res, "", Duration.ZERO); // one attempt per cookie
        Pending pending = parts.length == 4 ? new Pending(parts[0], parts[1]) : null;
        String language = parts.length == 4 && "ar".equals(parts[2]) ? "ar" : "en";
        String next = parts.length == 4 && !parts[3].isEmpty() ? safeNext(decode(parts[3])) : null;
        try {
            Tokens tokens = google.complete(pending, state, code, error, language,
                    new ClientInfo(req.getRemoteAddr(), req.getHeader("User-Agent")));
            cookies.write(res, tokens.accessToken(), tokens.refreshToken());
            redirect(res, next != null ? next : prefix(language) + "/account");
        } catch (GoogleSignInException e) {
            redirect(res, failurePage(language, e.failure()));
        }
    }

    private void setPending(HttpServletResponse res, String value, Duration maxAge) {
        // Lax is sent on the top-level navigation back from Google.
        res.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(PENDING_COOKIE, value).httpOnly(true)
                .secure(security.cookieSecure()).sameSite("Lax").path(PENDING_PATH).maxAge(maxAge).build().toString());
    }

    private static void redirect(HttpServletResponse res, String location) {
        res.setStatus(HttpServletResponse.SC_FOUND);
        res.setHeader(HttpHeaders.LOCATION, location);
        res.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    }

    private static String failurePage(String lang, GoogleSignInService.Failure failure) {
        return prefix(lang) + "/sign-in?google=" + failure.name().toLowerCase(Locale.ROOT);
    }

    private static String prefix(String lang) {
        return "ar".equals(lang) ? "/ar" : "";
    }

    private static String decode(String value) {
        try {
            return new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** Only a path on this site, so the flow cannot be used to send someone elsewhere. */
    static String safeNext(String next) {
        if (next == null || next.length() > 300 || !next.startsWith("/") || next.startsWith("//")
                || next.contains("\\") || next.startsWith("/api/") || next.chars().anyMatch(c -> c < 0x20 || c == 0x7f)) {
            return null;
        }
        return next;
    }
}
