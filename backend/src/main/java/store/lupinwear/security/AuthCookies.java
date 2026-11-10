package store.lupinwear.security;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.util.Optional;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/** Auth tokens live only in HttpOnly cookies. JavaScript never sees them. */
@Component
public class AuthCookies {

    public static final String ACCESS = "lw_at";
    public static final String REFRESH = "lw_rt";
    /** The refresh token is only ever sent to the auth endpoints. */
    private static final String REFRESH_PATH = "/api/v1/auth";

    private final SecurityProperties props;

    public AuthCookies(SecurityProperties props) {
        this.props = props;
    }

    /**
     * Not a credential: just "1", readable by the page, so a guest's browser does not ask "who am I?"
     * on every page view. Forging it gains nothing; every request is still checked against the real cookies.
     */
    public static final String HINT = "lw_s";

    public void write(HttpServletResponse response, String accessToken, String refreshToken) {
        add(response, ACCESS, accessToken, "/", props.accessTokenTtl());
        add(response, REFRESH, refreshToken, REFRESH_PATH, props.refreshTokenTtl());
        hint(response, "1", props.refreshTokenTtl());
    }

    public void clear(HttpServletResponse response) {
        add(response, ACCESS, "", "/", Duration.ZERO);
        add(response, REFRESH, "", REFRESH_PATH, Duration.ZERO);
        hint(response, "", Duration.ZERO);
    }

    private void hint(HttpServletResponse response, String value, Duration maxAge) {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(HINT, value).httpOnly(false)
                .secure(props.cookieSecure()).sameSite("Lax").path("/").maxAge(maxAge).build().toString());
    }

    public static Optional<String> read(HttpServletRequest request, String name) {
        if (request.getCookies() == null) {
            return Optional.empty();
        }
        for (Cookie c : request.getCookies()) {
            if (name.equals(c.getName()) && !c.getValue().isBlank()) {
                return Optional.of(c.getValue());
            }
        }
        return Optional.empty();
    }

    private void add(HttpServletResponse response, String name, String value, String path, Duration maxAge) {
        ResponseCookie cookie = ResponseCookie.from(name, value)
                .httpOnly(true)
                .secure(props.cookieSecure())
                .sameSite("Lax")
                .path(path)
                .maxAge(maxAge)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
