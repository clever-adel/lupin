package store.lupinwear.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import store.lupinwear.shared.GlobalExceptionHandler.ErrorBody;

/**
 * The API is meant to be reached only through the storefront Worker, which adds a shared key to
 * every request it forwards. A request that arrives without the right key came straight to the
 * server's own address and is refused, so nobody can bypass the Worker, forge "X-Forwarded-*"
 * (client address, host) or sidestep the same-origin cookie setup.
 *
 * Runs first, before the forwarded-header handling and before authentication. Health probes are
 * exempt: the hosting platform calls them directly.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class EdgeKeyFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Lupin-Edge-Key";

    private final byte[] expected;
    private final ObjectMapper json;
    private final Environment environment;

    public EdgeKeyFilter(SecurityProperties props, ObjectMapper json, Environment environment) {
        String secret = props.edgeSecret() == null ? "" : props.edgeSecret().trim();
        this.expected = secret.getBytes(StandardCharsets.UTF_8);
        this.json = json;
        this.environment = environment;
    }

    /** A deployed server without the key would be wide open, so it refuses to start. */
    @PostConstruct
    void requireKeyWhenDeployed() {
        boolean deployed = Arrays.stream(environment.getActiveProfiles())
                .anyMatch(p -> p.equals("production") || p.equals("staging"));
        if (deployed && expected.length < 32) {
            throw new IllegalStateException(
                    "LUPIN_EDGE_SECRET must be set (at least 32 characters) in staging and production.");
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return expected.length == 0 || request.getRequestURI().startsWith("/actuator/health");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String given = request.getHeader(HEADER);
        if (given == null || !MessageDigest.isEqual(expected, given.getBytes(StandardCharsets.UTF_8))) {
            response.setStatus(HttpStatus.FORBIDDEN.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            json.writeValue(response.getOutputStream(), ErrorBody.of("FORBIDDEN", "Not available here."));
            return;
        }
        chain.doFilter(request, response);
    }
}
