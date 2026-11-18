package store.lupinwear.auth.google;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * "Continue with Google" (OAuth 2.0 / OpenID Connect, web client "Lupin." in Google Cloud project
 * lupin-store). The client ID is public; the secret comes from the environment only. Switched off
 * until both are present.
 */
@ConfigurationProperties("lupin.google")
public record GoogleProperties(String clientId, String clientSecret) {

    public boolean configured() {
        return clientId != null && !clientId.isBlank() && clientSecret != null && !clientSecret.isBlank();
    }

    /** Never print the secret, even by accident in a log line. */
    @Override
    public String toString() {
        return "GoogleProperties[clientId=" + clientId + ", configured=" + configured() + "]";
    }
}
