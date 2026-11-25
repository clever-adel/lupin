package store.lupinwear.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import store.lupinwear.shared.GlobalExceptionHandler.ErrorBody;

/**
 * Turns a valid access-token cookie into an authenticated request. Anything else stays anonymous.
 *
 * Customer requests trust the roles inside the token (no database hit). Staff requests do not: for
 * /api/v1/admin/** the account's status, roles and sessions are read from the database on every
 * request, so a staff member who is disabled, loses a role, or has their password reset is locked
 * out at once, not when the token expires.
 *
 * Staff requests also need two-step sign-in: the sign-in this token belongs to must have passed the
 * authenticator-app code. Without it the answer is 403 MFA_REQUIRED, and the dashboard asks for it.
 */
@Component
public class JwtCookieAuthFilter extends OncePerRequestFilter {

    private static final String ADMIN_PREFIX = "/api/v1/admin/";
    public static final String MFA_REQUIRED = "MFA_REQUIRED";

    private final JwtService jwt;
    private final JdbcClient jdbc;
    private final ObjectMapper json;

    public JwtCookieAuthFilter(JwtService jwt, JdbcClient jdbc, ObjectMapper json) {
        this.jwt = jwt;
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Optional<CurrentUser> parsed = AuthCookies.read(request, AuthCookies.ACCESS).flatMap(jwt::parse);
        if (parsed.isPresent() && request.getRequestURI().startsWith(ADMIN_PREFIX)) {
            CurrentUser fromToken = parsed.get();
            CurrentUser current = new CurrentUser(fromToken.id(), currentRoles(fromToken), fromToken.family());
            if (current.isStaff() && !twoStepDone(current)) {
                response.setStatus(HttpStatus.FORBIDDEN.value());
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                json.writeValue(response.getOutputStream(), ErrorBody.of(MFA_REQUIRED,
                        "Confirm your sign-in with the code from your authenticator app."));
                return;
            }
            parsed = Optional.of(current);
        }
        parsed.filter(user -> !user.roles().isEmpty()).ifPresent(user -> {
            var authorities = user.roles().stream().map(r -> new SimpleGrantedAuthority("ROLE_" + r)).toList();
            SecurityContextHolder.getContext()
                    .setAuthentication(new UsernamePasswordAuthenticationToken(user, null, authorities));
        });
        chain.doFilter(request, response);
    }

    /** Empty when the account is disabled or deleted. */
    private Set<String> currentRoles(CurrentUser user) {
        return new HashSet<>(jdbc.sql("""
                select r.code from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
                where u.id = :id and u.status = 'ACTIVE' and u.deleted_at is null
                  -- and still has a session that was not ended (password reset, sign-out everywhere, disable)
                  and exists (select 1 from auth_sessions s
                              where s.user_id = u.id and s.revoked_at is null and s.expires_at > now())
                """).param("id", user.id()).query(String.class).list());
    }

    /** The account has the app switched on and this very sign-in passed its code. */
    private boolean twoStepDone(CurrentUser user) {
        UUID family = user.family();
        return family != null && jdbc.sql("""
                select exists (select 1 from users u join auth_sessions s on s.user_id = u.id
                               where u.id = :id and u.totp_enabled_at is not null
                                 and s.family_id = :family and s.mfa_at is not null
                                 and s.revoked_at is null and s.expires_at > now())
                """).param("id", user.id()).param("family", family).query(Boolean.class).single();
    }
}
