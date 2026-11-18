package store.lupinwear.notify;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import store.lupinwear.shared.ApiException;

/**
 * New-order alerts in Telegram. Only chats that an active owner or admin linked from the dashboard
 * get anything: anyone else who finds the bot and presses Start is told it is for the LUPIN team.
 */
@Service
public class StaffTelegram {

    private static final Logger log = LoggerFactory.getLogger(StaffTelegram.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    static final String WEBHOOK_PATH = "/api/v1/telegram/webhook";
    private static final Duration CODE_LIFETIME = Duration.ofMinutes(15);

    public record Linked(String username, Instant linkedAt) {
    }

    public record Status(boolean configured, String botUsername, List<Linked> linked) {
    }

    private final JdbcClient jdbc;
    private final TelegramGateway telegram;
    private final TelegramProperties props;
    private final Clock clock;
    private final String publicBaseUrl;

    public StaffTelegram(JdbcClient jdbc, TelegramGateway telegram, TelegramProperties props, Clock clock,
            @Value("${lupin.public-base-url}") String publicBaseUrl) {
        this.jdbc = jdbc;
        this.telegram = telegram;
        this.props = props;
        this.clock = clock;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    /** Telegram must know where to send updates; done once at start-up, off the main thread. */
    @EventListener(ApplicationReadyEvent.class)
    public void registerWebhook() {
        if (!telegram.configured() || !publicBaseUrl.startsWith("https://")) {
            return;
        }
        Thread.ofVirtual().name("telegram-webhook").start(() -> {
            if (telegram.setWebhook(publicBaseUrl + WEBHOOK_PATH, webhookSecret())) {
                log.info("Telegram webhook set");
            }
        });
    }

    /**
     * The value Telegram sends back in X-Telegram-Bot-Api-Secret-Token. Derived from the bot token, so
     * it needs no setting of its own and changes when the token does.
     */
    public String webhookSecret() {
        if (!props.configured()) {
            return null;
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(props.botToken().trim().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal("lupin-telegram-webhook".getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public boolean secretMatches(String header) {
        String expected = webhookSecret();
        return expected != null && header != null && MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8), header.getBytes(StandardCharsets.UTF_8));
    }

    public Status status(UUID user) {
        List<Linked> linked = jdbc.sql("select username, created_at from telegram_chats where user_id = :u order by created_at")
                .param("u", user)
                .query((rs, n) -> new Linked(rs.getString(1), rs.getObject(2, OffsetDateTime.class).toInstant())).list();
        return new Status(telegram.configured(), telegram.configured() ? telegram.botUsername() : null, linked);
    }

    /** A t.me link that opens the bot with a one-time code; pressing Start there links that chat. */
    @Transactional
    public String linkUrl(UUID user) {
        if (!telegram.configured()) {
            throw ApiException.conflict("TELEGRAM_NOT_SET_UP", "Set TELEGRAM_BOT_TOKEN on the server first.");
        }
        String bot = telegram.botUsername();
        if (bot == null) {
            throw ApiException.conflict("TELEGRAM_UNREACHABLE", "Telegram cannot be reached right now. Try again.");
        }
        registerWebhook();
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        String code = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant now = clock.instant();
        jdbc.sql("delete from telegram_link_codes where user_id = :u or expires_at < :now")
                .param("u", user).param("now", OffsetDateTime.ofInstant(now, ZoneOffset.UTC)).update();
        jdbc.sql("insert into telegram_link_codes (code_hash, user_id, expires_at) values (:h, :u, :e)")
                .param("h", sha256(code)).param("u", user)
                .param("e", OffsetDateTime.ofInstant(now.plus(CODE_LIFETIME), ZoneOffset.UTC)).update();
        return "https://t.me/" + bot + "?start=" + code;
    }

    @Transactional
    public void unlink(UUID user) {
        List<Long> chats = jdbc.sql("delete from telegram_chats where user_id = :u returning chat_id").param("u", user)
                .query(Long.class).list();
        for (long chat : chats) {
            telegram.sendMessage(chat, "تم فصل حسابك عن تنبيهات LUPIN. مش هيوصلك طلبات هنا تاني.", null, null);
        }
    }

    /** One update from Telegram's webhook (already checked to carry our secret). */
    @Transactional
    public void handle(JsonNode update) {
        JsonNode message = update.path("message");
        long chat = message.path("chat").path("id").asLong(0);
        String type = message.path("chat").path("type").asText("");
        String text = message.path("text").asText("").trim();
        if (chat == 0 || text.isEmpty()) {
            return;
        }
        if (!"private".equals(type)) {
            return; // groups: say nothing
        }
        String username = message.path("from").path("username").asText("");
        if (text.startsWith("/start")) {
            String code = text.length() > 6 ? text.substring(6).trim() : "";
            UUID user = code.matches("[A-Za-z0-9_-]{20,64}") ? jdbc.sql("""
                    delete from telegram_link_codes where code_hash = :h and expires_at > :now returning user_id""")
                    .param("h", sha256(code)).param("now", OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC))
                    .query(UUID.class).optional().orElse(null) : null;
            if (user == null || !activeStaff(user)) {
                if (!linked(chat)) {
                    telegram.sendMessage(chat, "البوت ده لفريق LUPIN بس.\nلو إنت من الفريق، اربط حسابك من الداشبورد: Settings ← Telegram.", null, null);
                }
                return;
            }
            jdbc.sql("""
                    insert into telegram_chats (user_id, chat_id, username) values (:u, :c, :n)
                    on conflict (chat_id) do update set user_id = excluded.user_id, username = excluded.username
                    """).param("u", user).param("c", chat).param("n", username.isEmpty() ? null : username).update();
            String name = jdbc.sql("select full_name from users where id = :u").param("u", user).query(String.class).single();
            telegram.sendMessage(chat, "✅ أهلًا " + html(name) + "، حسابك اتربط.\nهيوصلك هنا كل طلب جديد في LUPIN.\n\nلو عايز توقف التنبيهات ابعت /stop", null, null);
            return;
        }
        if (text.equals("/stop")) {
            int removed = jdbc.sql("delete from telegram_chats where chat_id = :c").param("c", chat).update();
            telegram.sendMessage(chat, removed > 0 ? "تمام، وقفنا التنبيهات. تقدر تربط تاني من الداشبورد في أي وقت."
                    : "البوت ده لفريق LUPIN بس.", null, null);
            return;
        }
        if (linked(chat)) {
            telegram.sendMessage(chat, "هيوصلك هنا كل طلب جديد. لوقف التنبيهات ابعت /stop", null, null);
        }
    }

    /** To every chat of an active owner or admin. Returns how many got it. Never throws. */
    public int send(String html, String buttonText, String path) {
        return sendTo(null, html, buttonText, path);
    }

    public int sendTo(UUID onlyUser, String html, String buttonText, String path) {
        if (!telegram.configured()) {
            return 0;
        }
        List<Long> chats = jdbc.sql("""
                select c.chat_id from telegram_chats c join users u on u.id = c.user_id
                where u.status = 'ACTIVE' and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                    where ur.user_id = u.id and r.code in ('OWNER', 'ADMIN'))
                  and (cast(:only as uuid) is null or u.id = :only)
                """).param("only", onlyUser).query(Long.class).list();
        // Telegram only accepts https addresses on buttons (a local run has none).
        String url = path != null && publicBaseUrl.startsWith("https://") ? publicBaseUrl + path : null;
        int sent = 0;
        for (long chat : chats) {
            int status = telegram.sendMessage(chat, html, buttonText, url);
            if (status == 200) {
                sent++;
            } else if (status == 403) {
                // The person blocked the bot or deleted the chat: stop trying.
                jdbc.sql("delete from telegram_chats where chat_id = :c").param("c", chat).update();
            }
        }
        return sent;
    }

    private boolean activeStaff(UUID user) {
        return jdbc.sql("""
                select count(*) from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
                where u.id = :u and u.status = 'ACTIVE' and r.code in ('OWNER', 'ADMIN')""")
                .param("u", user).query(Long.class).single() > 0;
    }

    private boolean linked(long chat) {
        return jdbc.sql("select count(*) from telegram_chats where chat_id = :c").param("c", chat)
                .query(Long.class).single() > 0;
    }

    public static String html(String value) {
        return value == null ? "" : value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
