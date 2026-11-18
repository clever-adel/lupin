package store.lupinwear.notify;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * WhatsApp Cloud API (Meta). The access token comes from the environment only. Off until the token
 * and the sender's phone number ID are present. The message is an approved template whose body has
 * four variables: {{1}} order reference, {{2}} customer name, {{3}} total, {{4}} payment method.
 */
@ConfigurationProperties("lupin.whatsapp")
public record WhatsAppProperties(String token, String phoneNumberId, String template, String templateLang,
        String apiVersion) {

    public WhatsAppProperties {
        template = blank(template) ? "new_order" : template.trim();
        templateLang = blank(templateLang) ? "ar" : templateLang.trim();
        apiVersion = blank(apiVersion) ? "v21.0" : apiVersion.trim();
    }

    public boolean configured() {
        return !blank(token) && !blank(phoneNumberId);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    /** Never print the token, even by accident in a log line. */
    @Override
    public String toString() {
        return "WhatsAppProperties[configured=" + configured() + ", template=" + template + "]";
    }
}
