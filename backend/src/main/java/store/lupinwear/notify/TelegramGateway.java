package store.lupinwear.notify;

/** The Telegram Bot API. Implementations must not throw: failures are logged and reported as a status. */
public interface TelegramGateway {

    boolean configured();

    /** The bot's @username (without "@"), or null when it cannot be read. */
    String botUsername();

    /**
     * Sends an HTML message, with one link button when {@code buttonUrl} is set. Returns the HTTP status
     * (200 sent, 403 the person blocked the bot, 400 chat gone), or 0 when Telegram could not be reached.
     */
    int sendMessage(long chatId, String html, String buttonText, String buttonUrl);

    /** Points Telegram at our webhook; {@code secret} comes back in every update's header. */
    boolean setWebhook(String url, String secret);
}
