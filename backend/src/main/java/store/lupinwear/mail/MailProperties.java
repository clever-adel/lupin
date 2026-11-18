package store.lupinwear.mail;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Outgoing email (Resend). Sending is switched off until the API key is present; the key comes from
 * the environment only. {@code logLinks} is for local runs: the message is written to the log instead.
 */
@ConfigurationProperties("lupin.mail")
public record MailProperties(String resendApiKey, String from, String baseUrl, boolean logLinks) {

    public MailProperties {
        from = blank(from) ? "LUPIN <no-reply@lupinwear.store>" : from.trim();
        baseUrl = blank(baseUrl) ? "https://api.resend.com" : baseUrl.replaceAll("/+$", "");
    }

    public boolean configured() {
        return !blank(resendApiKey);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    /** Never print the key, even by accident in a log line. */
    @Override
    public String toString() {
        return "MailProperties[configured=" + configured() + ", from=" + from + "]";
    }
}
