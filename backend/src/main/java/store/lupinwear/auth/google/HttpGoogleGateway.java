package store.lupinwear.auth.google;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.Set;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;

/**
 * Google's OAuth 2.0 token endpoint (developers.google.com/identity/openid-connect/openid-connect,
 * "Exchange code for access token and ID token"). The ID token arrives straight from Google over
 * TLS in answer to our own authenticated request, so, as that page and OpenID Connect Core 3.1.3.7
 * allow, its claims are checked (issuer, audience, expiry) without fetching Google's signing keys.
 */
@Component
public class HttpGoogleGateway implements GoogleGateway {

    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final Set<String> ISSUERS = Set.of("https://accounts.google.com", "accounts.google.com");

    private final GoogleProperties props;
    private final ObjectMapper json;
    private final Clock clock;
    private final RestClient http;

    public HttpGoogleGateway(GoogleProperties props, ObjectMapper json, Clock clock) {
        this.props = props;
        this.json = json;
        this.clock = clock;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(15));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    @Override
    public Profile exchange(String code, String codeVerifier, String redirectUri) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("code", code);
        form.add("client_id", props.clientId());
        form.add("client_secret", props.clientSecret());
        form.add("redirect_uri", redirectUri);
        form.add("grant_type", "authorization_code");
        form.add("code_verifier", codeVerifier);
        JsonNode body = http.post().uri(TOKEN_URL).contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form).retrieve().body(JsonNode.class);
        String idToken = body == null ? null : body.path("id_token").asText(null);
        if (idToken == null) {
            throw new IllegalStateException("Google returned no ID token");
        }
        String[] parts = idToken.split("\\.");
        if (parts.length != 3) {
            throw new IllegalStateException("Malformed ID token");
        }
        JsonNode claims;
        try {
            claims = json.readTree(Base64.getUrlDecoder().decode(parts[1]));
        } catch (IOException | IllegalArgumentException e) {
            throw new IllegalStateException("Unreadable ID token", e);
        }
        if (!ISSUERS.contains(claims.path("iss").asText())
                || !props.clientId().equals(claims.path("aud").asText())
                || claims.path("exp").asLong() < clock.instant().getEpochSecond()) {
            throw new IllegalStateException("ID token failed its checks");
        }
        return new Profile(claims.path("sub").asText(), claims.path("email").asText(null),
                claims.path("email_verified").asBoolean(false), claims.path("name").asText(""));
    }
}
