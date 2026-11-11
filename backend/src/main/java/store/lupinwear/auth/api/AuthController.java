package store.lupinwear.auth.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.auth.api.AuthDtos.CsrfResponse;
import store.lupinwear.auth.api.AuthDtos.LoginRequest;
import store.lupinwear.auth.api.AuthDtos.MeResponse;
import store.lupinwear.auth.api.AuthDtos.RegisterRequest;
import store.lupinwear.auth.application.AuthService;
import store.lupinwear.auth.application.AuthService.ClientInfo;
import store.lupinwear.auth.application.AuthService.Tokens;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.shared.ApiException;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService auth;
    private final AuthCookies cookies;

    public AuthController(AuthService auth, AuthCookies cookies) {
        this.auth = auth;
        this.cookies = cookies;
    }

    /** Reading the token makes Spring Security set the XSRF-TOKEN cookie the SPA echoes back. */
    @GetMapping("/csrf")
    CsrfResponse csrf(CsrfToken token) {
        return new CsrfResponse(token.getHeaderName(), token.getToken());
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    MeResponse register(@Valid @RequestBody RegisterRequest body, HttpServletRequest req, HttpServletResponse res) {
        return signedIn(auth.register(body, client(req)), res);
    }

    @PostMapping("/login")
    MeResponse login(@Valid @RequestBody LoginRequest body, HttpServletRequest req, HttpServletResponse res) {
        return signedIn(auth.login(body, client(req)), res);
    }

    @PostMapping("/refresh")
    MeResponse refresh(HttpServletRequest req, HttpServletResponse res) {
        String token = AuthCookies.read(req, AuthCookies.REFRESH).orElse(null);
        if (token == null) {
            throw ApiException.unauthorized("SESSION_EXPIRED", "Your session has ended. Please sign in again.");
        }
        try {
            return signedIn(auth.refresh(token, client(req)), res);
        } catch (ApiException e) {
            cookies.clear(res);
            throw e;
        }
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void logout(HttpServletRequest req, HttpServletResponse res) {
        auth.logout(AuthCookies.read(req, AuthCookies.REFRESH).orElse(null));
        cookies.clear(res);
    }

    @PostMapping("/logout-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void logoutAll(@AuthenticationPrincipal CurrentUser user, HttpServletResponse res) {
        auth.logoutEverywhere(user.id());
        cookies.clear(res);
    }

    /** Ends every session, this one included: the browser must sign in again with the new password. */
    @PostMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void changePassword(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody AuthDtos.PasswordChangeRequest body,
            HttpServletResponse res) {
        auth.changeOwnPassword(user.id(), body.currentPassword(), body.newPassword());
        cookies.clear(res);
    }

    @GetMapping("/me")
    MeResponse me(@AuthenticationPrincipal CurrentUser user) {
        return MeResponse.of(auth.me(user.id()));
    }

    private MeResponse signedIn(Tokens tokens, HttpServletResponse res) {
        cookies.write(res, tokens.accessToken(), tokens.refreshToken());
        return MeResponse.of(tokens.user());
    }

    private static ClientInfo client(HttpServletRequest req) {
        return new ClientInfo(req.getRemoteAddr(), req.getHeader("User-Agent"));
    }
}
