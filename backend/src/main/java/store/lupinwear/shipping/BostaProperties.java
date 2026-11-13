package store.lupinwear.shipping;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Bosta settings. The API key and the webhook secret come from the environment / secret store only.
 * The integration is switched off until both are present.
 */
@ConfigurationProperties("lupin.bosta")
public record BostaProperties(String apiKey, String baseUrl, String webhookSecret, String webhookHeader,
        String businessLocationId, String packageType) {

    public BostaProperties {
        baseUrl = blank(baseUrl) ? "https://app.bosta.co/api/v2" : baseUrl.replaceAll("/+$", "");
        webhookHeader = blank(webhookHeader) ? "X-Lupin-Webhook-Key" : webhookHeader.trim();
        packageType = blank(packageType) ? "Small" : packageType.trim();
    }

    public boolean configured() {
        return !blank(apiKey) && !blank(webhookSecret) && webhookSecret.trim().length() >= 24;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    /** Never print the key or the secret, even by accident in a log line. */
    @Override
    public String toString() {
        return "BostaProperties[configured=" + configured() + ", baseUrl=" + baseUrl + "]";
    }
}
