package store.lupinwear.look.tryon;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI photos for looks. FASHN is used when its key is present (environment only, never in the code or
 * the browser). Without a key, {@code localPreview} switches on labelled test images for development.
 */
@ConfigurationProperties("lupin.tryon")
public record TryOnProperties(String fashnApiKey, String fashnBaseUrl, Integer candidates, boolean localPreview) {

    public boolean fashnConfigured() {
        return fashnApiKey != null && !fashnApiKey.isBlank();
    }

    public String baseUrl() {
        return fashnBaseUrl == null || fashnBaseUrl.isBlank() ? "https://api.fashn.ai/v1" : fashnBaseUrl.replaceAll("/+$", "");
    }

    public int candidateCount() {
        return candidates == null ? 2 : Math.clamp(candidates, 1, 4);
    }
}
