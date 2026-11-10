package store.lupinwear.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import store.lupinwear.shared.GlobalExceptionHandler.ErrorBody;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    /** Provider callbacks cannot carry a CSRF token; they are authenticated by HMAC signature instead. */
    public static final String WEBHOOKS = "/api/v1/payments/webhooks/**";

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, JwtCookieAuthFilter jwtFilter, SecurityProperties props,
            ObjectMapper json) throws Exception {
        var csrfRepo = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrfRepo.setCookieCustomizer(c -> c.secure(props.cookieSecure()).sameSite("Lax").path("/"));

        http
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .cors(c -> c.configurationSource(cors(props)))
            // Double-submit cookie: the SPA echoes the XSRF-TOKEN cookie in the X-XSRF-TOKEN header.
            .csrf(c -> c.csrfTokenRepository(csrfRepo)
                    .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())
                    .ignoringRequestMatchers(WEBHOOKS))
            .formLogin(f -> f.disable())
            .httpBasic(b -> b.disable())
            .logout(l -> l.disable())
            .requestCache(r -> r.disable())
            .headers(h -> h
                    .httpStrictTransportSecurity(s -> s.includeSubDomains(true).maxAgeInSeconds(31_536_000))
                    .frameOptions(f -> f.deny())
                    .referrerPolicy(r -> r.policy(ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN))
                    .permissionsPolicyHeader(p -> p.policy("camera=(), microphone=(), geolocation=()")))
            .authorizeHttpRequests(a -> a
                    .requestMatchers("/api/v1/admin/**").hasAnyRole("ADMIN", "OWNER")
                    .requestMatchers("/api/v1/auth/me", "/api/v1/auth/logout-all").authenticated()
                    .requestMatchers("/api/v1/auth/**").permitAll()
                    .requestMatchers(HttpMethod.GET, "/api/v1/catalog/**", "/api/v1/content/**",
                            "/api/v1/delivery/**").permitAll()
                    .requestMatchers(WEBHOOKS).permitAll()
                    .requestMatchers("/actuator/health/**", "/actuator/info").permitAll()
                    .requestMatchers("/api/v1/openapi/**", "/api/v1/docs/**", "/swagger-ui/**").permitAll()
                    .anyRequest().authenticated())
            .exceptionHandling(e -> e
                    .authenticationEntryPoint((req, res, ex) -> write(json, res, HttpStatus.UNAUTHORIZED,
                            "UNAUTHENTICATED", "Please sign in."))
                    .accessDeniedHandler((req, res, ex) -> write(json, res, HttpStatus.FORBIDDEN,
                            "FORBIDDEN", "You are not allowed to do this.")))
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    private static void write(ObjectMapper json, HttpServletResponse res, HttpStatus status, String code,
            String message) throws IOException {
        res.setStatus(status.value());
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        json.writeValue(res.getOutputStream(), ErrorBody.of(code, message));
    }

    /** Closed by default. In production the browser reaches the API same-origin through the Worker. */
    private static CorsConfigurationSource cors(SecurityProperties props) {
        var config = new CorsConfiguration();
        config.setAllowedOrigins(props.allowedOrigins());
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE"));
        config.setAllowedHeaders(List.of("Content-Type", "X-XSRF-TOKEN", "Accept-Language"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);
        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
    }

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}
