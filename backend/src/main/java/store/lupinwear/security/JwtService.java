package store.lupinwear.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import java.time.Clock;
import java.time.Instant;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Service;

@Service
public class JwtService {

    private static final String ISSUER = "lupinwear.store";

    private final SecretKey key;
    private final SecurityProperties props;
    private final Clock clock;

    public JwtService(SecurityProperties props, Clock clock) {
        // Hosts generate this value for us; some use the URL-safe base64 alphabet. Accept both.
        byte[] secret = Decoders.BASE64.decode(props.jwtSecret().trim().replace('-', '+').replace('_', '/'));
        if (secret.length < 32) {
            throw new IllegalStateException("LUPIN_JWT_SECRET must be at least 32 bytes (base64 encoded)");
        }
        this.key = Keys.hmacShaKeyFor(secret);
        this.props = props;
        this.clock = clock;
    }

    public String issueAccessToken(UUID userId, Set<String> roles) {
        Instant now = clock.instant();
        return Jwts.builder()
                .issuer(ISSUER)
                .subject(userId.toString())
                .claim("roles", List.copyOf(roles))
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(props.accessTokenTtl())))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    /** Empty when the token is missing, malformed, expired or signed with another key. */
    public Optional<CurrentUser> parse(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .requireIssuer(ISSUER)
                    .clock(() -> Date.from(clock.instant()))
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            Set<String> roles = new HashSet<>();
            if (claims.get("roles") instanceof List<?> list) {
                list.forEach(r -> roles.add(String.valueOf(r)));
            }
            return Optional.of(new CurrentUser(UUID.fromString(claims.getSubject()), Set.copyOf(roles)));
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
