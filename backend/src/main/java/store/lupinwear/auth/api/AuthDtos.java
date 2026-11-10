package store.lupinwear.auth.api;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Set;
import java.util.UUID;
import store.lupinwear.auth.domain.User;

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

    public record LoginRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Size(max = 128) String password) {
    }

    public record MeResponse(UUID id, String email, String phone, String fullName, Set<String> roles,
            boolean emailVerified, String preferredLang) {

        public static MeResponse of(User u) {
            return new MeResponse(u.getId(), u.getEmail(), u.getPhone(), u.getFullName(), u.roleCodes(),
                    u.getEmailVerifiedAt() != null, u.getPreferredLang());
        }
    }

    public record CsrfResponse(String headerName, String token) {
    }
}
