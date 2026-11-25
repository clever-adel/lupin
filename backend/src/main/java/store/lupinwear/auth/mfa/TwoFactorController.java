package store.lupinwear.auth.mfa;

import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.audit.AuditLog;
import store.lupinwear.auth.api.AuthDtos.CodeRequest;
import store.lupinwear.auth.mfa.TwoFactorService.Pairing;
import store.lupinwear.auth.mfa.TwoFactorService.Status;
import store.lupinwear.security.CurrentUser;

/**
 * A staff member switches on two-step sign-in for their own account. Outside /api/v1/admin on purpose:
 * these must work before the second step is done. The sign-in step itself is AuthController's /mfa/verify.
 */
@RestController
@RequestMapping("/api/v1/auth/mfa")
@PreAuthorize("hasAnyRole('ADMIN','OWNER')")
public class TwoFactorController {

    private final TwoFactorService twoFactor;
    private final AuditLog audit;

    public TwoFactorController(TwoFactorService twoFactor, AuditLog audit) {
        this.twoFactor = twoFactor;
        this.audit = audit;
    }

    @GetMapping("/status")
    Status status(@AuthenticationPrincipal CurrentUser user) {
        return twoFactor.status(user.id(), user.family());
    }

    /** A new key for the app: the QR code's contents and the same key as text. */
    @PostMapping("/setup")
    Pairing setup(@AuthenticationPrincipal CurrentUser user) {
        return twoFactor.beginSetup(user.id(), user.family());
    }

    /** The first code from the app switches it on. The answer holds the recovery codes, shown only this once. */
    @PostMapping("/enable")
    Map<String, List<String>> enable(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody CodeRequest body) {
        List<String> codes = twoFactor.enable(user.id(), user.family(), body.code());
        audit.record(user.id(), "MFA_ENABLED", "user", user.id(), null);
        return Map.of("recoveryCodes", codes);
    }

    @PostMapping("/recovery-codes")
    Map<String, List<String>> recoveryCodes(@AuthenticationPrincipal CurrentUser user,
            @Valid @RequestBody CodeRequest body) {
        List<String> codes = twoFactor.newRecoveryCodes(user.id(), user.family(), body.code());
        audit.record(user.id(), "MFA_RECOVERY_CODES", "user", user.id(), null);
        return Map.of("recoveryCodes", codes);
    }
}
