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
import store.lupinwear.auth.api.AuthDtos.CodeRequest;
import store.lupinwear.auth.api.AuthDtos.CsrfResponse;
import store.lupinwear.auth.api.AuthDtos.LoginRequest;
import store.lupinwear.auth.api.AuthDtos.MeResponse;
import store.lupinwear.auth.api.AuthDtos.MfaChallengeResponse;
import store.lupinwear.auth.api.AuthDtos.RegisterRequest;
import store.lupinwear.auth.application.AuthService;
import store.lupinwear.auth.application.AuthService.ClientInfo;
import store.lupinwear.auth.application.AuthService.LoginResult;
import store.lupinwear.auth.application.AuthService.Tokens;
import store.lupinwear.auth.application.PasswordResetService;
import store.lupinwear.auth.domain.User;
import store.lupinwear.auth.mfa.TwoFactorService;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.shared.ApiException;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService auth;
    private final AuthCookies cookies;
    private final PasswordResetService resets;
    private final TwoFactorService twoFactor;

    public AuthController(AuthService auth, AuthCookies cookies, PasswordResetService resets,
            TwoFactorService twoFactor) {
        this.auth = auth;
        this.cookies = cookies;
        this.resets = resets;
        this.twoFactor = twoFactor;
    }

    /** Reading the token makes Spring Security set the XSRF-TOKEN cookie the SPA echoes back. */
    @GetMapping("/csrf")
    CsrfResponse csrf(CsrfToken token) {
        return new CsrfResponse(token.getHeaderName(), token.getToken());
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    MeResponse register(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody RegisterRequest body,
            HttpServletRequest req, HttpServletResponse res) {
        return signedIn(auth.register(body, client(req), user == null ? null : user.id()), res);
    }

    /** Checkout without an account: signs this browser in as a new guest. */
    @PostMapping("/guest")
    @ResponseStatus(HttpStatus.CREATED)
    MeResponse guest(@RequestBody(required = false) AuthDtos.GuestRequest body, HttpServletRequest req,
            HttpServletResponse res) {
        return signedIn(auth.startGuest(body == null ? null : body.lang(), client(req)), res);
    }

    /** A session, or for staff with two-step sign-in on: {"mfaRequired": true} and a five-minute challenge cookie. */
    @PostMapping("/login")
    Object login(@Valid @RequestBody LoginRequest body, HttpServletRequest req, HttpServletResponse res) {
        LoginResult result = auth.login(body, client(req));
        if (result.mfaChallenge() != null) {
            cookies.writeMfaChallenge(res, result.mfaChallenge());
            return new MfaChallengeResponse(true);
        }
        return signedIn(result.tokens(), res);
    }

    /** The second step: the code from the authenticator app, or a recovery code. */
    @PostMapping("/mfa/verify")
    MeResponse verifyTwoStep(@Valid @RequestBody CodeRequest body, HttpServletRequest req, HttpServletResponse res) {
        String challenge = AuthCookies.read(req, AuthCookies.MFA).orElse(null);
        Tokens tokens = auth.completeTwoStep(challenge, body.code(), client(req));
        cookies.clearMfaChallenge(res);
        return signedIn(tokens, res);
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

    /** Always the same answer, whether or not the email has an account. */
    @PostMapping("/forgot-password")
    @ResponseStatus(HttpStatus.ACCEPTED)
    void forgotPassword(@Valid @RequestBody AuthDtos.ForgotPasswordRequest body, HttpServletRequest req) {
        resets.requestLink(body.email(), body.lang(), req.getRemoteAddr());
    }

    /** Ends every session of that person; this browser is signed out too and signs in with the new password. */
    @PostMapping("/reset-password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void resetPassword(@Valid @RequestBody AuthDtos.ResetPasswordRequest body, HttpServletRequest req,
            HttpServletResponse res) {
        resets.reset(body.token(), body.newPassword(), req.getRemoteAddr());
        cookies.clear(res);
    }

    @GetMapping("/me")
    MeResponse me(@AuthenticationPrincipal CurrentUser user) {
        User me = auth.me(user.id());
        return MeResponse.of(me, twoFactor.state(me.getId(), me.roleCodes(), user.family()));
    }

    private MeResponse signedIn(Tokens tokens, HttpServletResponse res) {
        cookies.write(res, tokens.accessToken(), tokens.refreshToken());
        User user = tokens.user();
        return MeResponse.of(user, twoFactor.state(user.getId(), user.roleCodes(), tokens.family()));
    }

    private static ClientInfo client(HttpServletRequest req) {
        return new ClientInfo(req.getRemoteAddr(), req.getHeader("User-Agent"));
    }
}
