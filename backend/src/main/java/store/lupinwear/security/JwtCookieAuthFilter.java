package store.lupinwear.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Turns a valid access-token cookie into an authenticated request. Anything else stays anonymous. */
@Component
public class JwtCookieAuthFilter extends OncePerRequestFilter {

    private final JwtService jwt;

    public JwtCookieAuthFilter(JwtService jwt) {
        this.jwt = jwt;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        AuthCookies.read(request, AuthCookies.ACCESS).flatMap(jwt::parse).ifPresent(user -> {
            var authorities = user.roles().stream().map(r -> new SimpleGrantedAuthority("ROLE_" + r)).toList();
            SecurityContextHolder.getContext()
                    .setAuthentication(new UsernamePasswordAuthenticationToken(user, null, authorities));
        });
        chain.doFilter(request, response);
    }
}
