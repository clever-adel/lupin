package store.lupinwear.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;

@Service
public class JwtService {

    private static final String ISSUER = "lupinwear.store";
    /** Marks the short-lived "password was right, now the app code" token, so it is never taken as a session. */
    private static final String TYPE = "typ";
    private static final String MFA_CHALLENGE = "mfa";
    private static final Duration MFA_CHALLENGE_TTL = Duration.ofMinutes(5);

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

    public String issueAccessToken(UUID userId, Set<String> roles, UUID family) {
        Instant now = clock.instant();
        return Jwts.builder()
                .issuer(ISSUER)
                .subject(userId.toString())
                .claim("roles", List.copyOf(roles))
                .claim("fam", family.toString())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(props.accessTokenTtl())))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    /** Empty when the token is missing, malformed, expired, signed with another key, or not an access token. */
    public Optional<CurrentUser> parse(String token) {
        return claims(token).filter(c -> c.get(TYPE) == null).map(claims -> {
            Set<String> roles = new HashSet<>();
            if (claims.get("roles") instanceof List<?> list) {
                list.forEach(r -> roles.add(String.valueOf(r)));
            }
            UUID family = claims.get("fam") instanceof String f ? UUID.fromString(f) : null;
            return new CurrentUser(UUID.fromString(claims.getSubject()), Set.copyOf(roles), family);
        });
    }

    /** Proof that the password was right, valid for a few minutes, exchanged for a session with the app code. */
    public String issueMfaChallenge(UUID userId) {
        Instant now = clock.instant();
        return Jwts.builder()
                .issuer(ISSUER)
                .subject(userId.toString())
                .claim(TYPE, MFA_CHALLENGE)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(MFA_CHALLENGE_TTL)))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    public Optional<UUID> parseMfaChallenge(String token) {
        return claims(token).filter(c -> MFA_CHALLENGE.equals(c.get(TYPE))).map(c -> UUID.fromString(c.getSubject()));
    }

    /** A key for another purpose, derived from the signing key so no extra secret has to be configured. */
    public byte[] deriveKey(String purpose) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key.getEncoded(), "HmacSHA256"));
            return mac.doFinal(purpose.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private Optional<Claims> claims(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.of(Jwts.parser()
                    .verifyWith(key)
                    .requireIssuer(ISSUER)
                    .clock(() -> Date.from(clock.instant()))
                    .build()
                    .parseSignedClaims(token)
                    .getPayload());
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
