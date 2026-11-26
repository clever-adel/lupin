package store.lupinwear.auth.api;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Set;
import java.util.UUID;
import store.lupinwear.auth.domain.User;
import store.lupinwear.auth.mfa.TwoFactorService;

public final class AuthDtos {

    private AuthDtos() {
    }

    public record RegisterRequest(
            @NotBlank @Size(min = 2, max = 120) String fullName,
            @NotBlank @Email @Size(max = 254) String email,
            @Pattern(regexp = "^01[0125][0-9]{8}$", message = "Enter an Egyptian mobile number, e.g. 01012345678")
            String phone,
            @NotBlank @Size(min = 10, max = 128, message = "Use at least 10 characters") String password,
            @Pattern(regexp = "en|ar") String lang) {
    }

    public record GuestRequest(@Pattern(regexp = "en|ar") String lang) {
    }

    public record LoginRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Size(max = 128) String password) {
    }

    public record PasswordChangeRequest(
            @NotBlank @Size(max = 128) String currentPassword,
            @NotBlank @Size(min = 10, max = 128, message = "Use at least 10 characters") String newPassword) {
    }

    public record ForgotPasswordRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @Pattern(regexp = "en|ar") String lang) {
    }

    public record ResetPasswordRequest(
            @NotBlank @Size(max = 100) String token,
            @NotBlank @Size(min = 10, max = 128, message = "Use at least 10 characters") String newPassword) {
    }

    /** {@code twoFactor}: staff only (ON, SETUP or SIGN_IN_AGAIN, see TwoFactorService.State); null for customers. */
    public record MeResponse(UUID id, String email, String phone, String fullName, Set<String> roles,
            boolean emailVerified, String preferredLang, String twoFactor, boolean guest) {

        public static MeResponse of(User u, TwoFactorService.State twoFactor) {
            return new MeResponse(u.getId(), u.getEmail(), u.getPhone(), u.getFullName(), u.roleCodes(),
                    u.getEmailVerifiedAt() != null, u.getPreferredLang(), twoFactor == null ? null : twoFactor.name(),
                    u.isGuest());
        }
    }

    /** The password was right; the authenticator-app code is asked for next. */
    public record MfaChallengeResponse(boolean mfaRequired) {
    }

    public record CodeRequest(@NotBlank @Size(max = 20) String code) {
    }

    public record CsrfResponse(String headerName, String token) {
    }
}
