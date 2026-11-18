package store.lupinwear.tracking;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Meta Conversions API. The access token comes from the environment only (Events Manager, the Pixel,
 * Settings, Conversions API, Generate access token). testEventCode sends events to "Test events".
 */
@ConfigurationProperties("lupin.meta")
public record MetaProperties(String capiToken, String testEventCode, String graphBase) {

    public MetaProperties {
        graphBase = graphBase == null || graphBase.isBlank() ? "https://graph.facebook.com/v21.0" : graphBase.replaceAll("/+$", "");
    }

    public boolean configured() {
        return capiToken != null && !capiToken.isBlank();
    }

    /** Never print the token. */
    @Override
    public String toString() {
        return "MetaProperties[configured=" + configured() + "]";
    }
}
