package store.lupinwear.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Turns a valid access-token cookie into an authenticated request. Anything else stays anonymous.
 *
 * Customer requests trust the roles inside the token (no database hit). Staff requests do not: for
 * /api/v1/admin/** the account's status, roles and sessions are read from the database on every
 * request, so a staff member who is disabled, loses a role, or has their password reset is locked
 * out at once, not when the token expires.
 */
@Component
public class JwtCookieAuthFilter extends OncePerRequestFilter {

    private static final String ADMIN_PREFIX = "/api/v1/admin/";

    private final JwtService jwt;
    private final JdbcClient jdbc;

    public JwtCookieAuthFilter(JwtService jwt, JdbcClient jdbc) {
        this.jwt = jwt;
        this.jdbc = jdbc;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Optional<CurrentUser> parsed = AuthCookies.read(request, AuthCookies.ACCESS).flatMap(jwt::parse);
        if (parsed.isPresent() && request.getRequestURI().startsWith(ADMIN_PREFIX)) {
            parsed = Optional.of(new CurrentUser(parsed.get().id(), currentRoles(parsed.get())));
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
}
