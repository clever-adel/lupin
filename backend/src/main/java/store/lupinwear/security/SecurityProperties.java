package store.lupinwear.security;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("lupin.security")
public record SecurityProperties(
        @NotBlank String jwtSecret,
        @NotNull Duration accessTokenTtl,
        @NotNull Duration refreshTokenTtl,
        boolean cookieSecure,
        List<String> allowedOrigins,
        @Min(3) int maxFailedLogins,
        @NotNull Duration lockoutBase,
        /** Shared with the storefront Worker. Empty only on a developer's machine and in tests. */
        String edgeSecret) {

    public SecurityProperties {
        allowedOrigins = allowedOrigins == null ? List.of()
                : allowedOrigins.stream().map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
