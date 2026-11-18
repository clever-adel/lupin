package store.lupinwear.notify;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** The Telegram bot (made with @BotFather). The token comes from the environment only. */
@ConfigurationProperties("lupin.telegram")
public record TelegramProperties(String botToken, String apiBase) {

    public TelegramProperties {
        apiBase = apiBase == null || apiBase.isBlank() ? "https://api.telegram.org" : apiBase.replaceAll("/+$", "");
    }

    public boolean configured() {
        return botToken != null && !botToken.isBlank();
    }

    /** Never print the token, even by accident in a log line. */
    @Override
    public String toString() {
        return "TelegramProperties[configured=" + configured() + "]";
    }
}
