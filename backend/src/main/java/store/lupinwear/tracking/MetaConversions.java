package store.lupinwear.tracking;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import store.lupinwear.content.SiteSettings;

/**
 * Server copy of the Pixel's Purchase event, so ads still learn from orders when a browser blocks the
 * Pixel. The browser sends the same event with the same event_id ("purchase-" + reference), and Meta
 * keeps only one. Customer details are SHA-256 hashed before they leave the server, as Meta requires.
 */
@Service
public class MetaConversions {

    private static final Logger log = LoggerFactory.getLogger(MetaConversions.class);

    /** What the shopper's browser told us when they placed the order. */
    public record Browser(String ip, String userAgent, String fbp, String fbc) {

        public static Browser from(HttpServletRequest request) {
            // The storefront's edge worker puts the shopper's own address here.
            String forwarded = request.getHeader("X-Forwarded-For");
            String ip = forwarded != null && !forwarded.isBlank() ? forwarded.split(",")[0].trim() : request.getRemoteAddr();
            String fbp = null;
            String fbc = null;
            if (request.getCookies() != null) {
                for (Cookie c : request.getCookies()) {
                    if ("_fbp".equals(c.getName())) {
                        fbp = c.getValue();
                    } else if ("_fbc".equals(c.getName())) {
                        fbc = c.getValue();
                    }
                }
            }
            return new Browser(ip, limit(request.getHeader("User-Agent")), limit(fbp), limit(fbc));
        }

        private static String limit(String value) {
            return value == null || value.length() > 400 ? null : value;
        }
    }

    private record Order(UUID id, UUID userId, BigDecimal total, String currency, String name, String phone,
            String city, String email, OffsetDateTime placedAt) {
    }

    private final JdbcClient jdbc;
    private final SiteSettings settings;
    private final MetaGateway meta;
    private final Clock clock;
    private final String publicBaseUrl;

    public MetaConversions(JdbcClient jdbc, SiteSettings settings, MetaGateway meta, Clock clock,
            @Value("${lupin.public-base-url}") String publicBaseUrl) {
        this.jdbc = jdbc;
        this.settings = settings;
        this.meta = meta;
        this.clock = clock;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    /** Sends the Purchase in the background. Does nothing until both the Pixel ID and the token are set. */
    public void purchaseLater(String reference, Browser browser) {
        String pixel = settings.metaPixelId();
        if (pixel == null || !meta.configured()) {
            return;
        }
        Thread.ofVirtual().name("meta-purchase-" + reference).start(() -> {
            try {
                Map<String, Object> payload = purchasePayload(reference, browser);
                if (payload != null) {
                    meta.send(pixel, payload);
                }
            } catch (RuntimeException e) {
                log.warn("Meta Purchase for {} not sent: {}", reference, e.getClass().getSimpleName());
            }
        });
    }

    Map<String, Object> purchasePayload(String reference, Browser browser) {
        Order order = jdbc.sql("""
                select o.id, o.user_id, o.total, o.currency, o.customer_name, o.customer_phone, o.city, u.email, o.placed_at
                from orders o join users u on u.id = o.user_id where o.reference = :r""").param("r", reference)
                .query((rs, n) -> new Order(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getBigDecimal(3),
                        rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8),
                        rs.getObject(9, OffsetDateTime.class)))
                .optional().orElse(null);
        if (order == null) {
            return null;
        }
        List<Map<String, Object>> contents = new ArrayList<>();
        List<String> ids = new ArrayList<>();
        int items = 0;
        for (Object[] row : jdbc.sql("select product_id, quantity, unit_price from order_items where order_id = :o order by id")
                .param("o", order.id())
                .query((rs, n) -> new Object[] {rs.getObject(1) == null ? "deleted" : String.valueOf(rs.getLong(1)),
                        rs.getInt(2), rs.getBigDecimal(3)})
                .list()) {
            String id = (String) row[0];
            contents.add(Map.of("id", id, "quantity", row[1], "item_price", row[2]));
            if (!ids.contains(id)) {
                ids.add(id);
            }
            items += (Integer) row[1];
        }

        Map<String, Object> user = new LinkedHashMap<>();
        putHashed(user, "em", normalEmail(order.email()));
        putHashed(user, "ph", normalPhone(order.phone()));
        String[] names = order.name() == null || order.name().isBlank() ? new String[0]
                : order.name().trim().toLowerCase(Locale.ROOT).split("\\s+");
        if (names.length > 0) {
            putHashed(user, "fn", names[0]);
        }
        if (names.length > 1) {
            putHashed(user, "ln", names[names.length - 1]);
        }
        putHashed(user, "ct", order.city() == null ? null : order.city().toLowerCase(Locale.ROOT).replaceAll("\\s+", ""));
        putHashed(user, "country", "eg");
        putHashed(user, "external_id", order.userId().toString());
        if (browser != null) {
            putPlain(user, "client_ip_address", browser.ip());
            putPlain(user, "client_user_agent", browser.userAgent());
            putPlain(user, "fbp", browser.fbp());
            putPlain(user, "fbc", browser.fbc());
        }

        Map<String, Object> custom = new LinkedHashMap<>();
        custom.put("currency", order.currency() == null ? "EGP" : order.currency());
        custom.put("value", order.total());
        custom.put("content_type", "product");
        custom.put("content_ids", ids);
        custom.put("contents", contents);
        custom.put("num_items", items);
        custom.put("order_id", reference);

        Map<String, Object> event = new LinkedHashMap<>();
        event.put("event_name", "Purchase");
        event.put("event_time", (order.placedAt() == null ? clock.instant() : order.placedAt().toInstant()).getEpochSecond());
        event.put("event_id", "purchase-" + reference);
        event.put("action_source", "website");
        event.put("event_source_url", publicBaseUrl + "/checkout");
        event.put("user_data", user);
        event.put("custom_data", custom);
        return Map.of("data", List.of(event));
    }

    static String normalEmail(String email) {
        return email == null || email.isBlank() ? null : email.trim().toLowerCase(Locale.ROOT);
    }

    /** Egyptian mobiles the way Meta wants them: country code, digits only (01012345678 becomes 201012345678). */
    static String normalPhone(String phone) {
        if (phone == null) {
            return null;
        }
        String digits = phone.replaceAll("\\D", "");
        if (digits.startsWith("0020")) {
            digits = digits.substring(2);
        } else if (digits.startsWith("01") && digits.length() == 11) {
            digits = "2" + digits;
        }
        return digits.isEmpty() ? null : digits;
    }

    private static void putHashed(Map<String, Object> user, String key, String value) {
        if (value != null && !value.isBlank()) {
            user.put(key, sha256(value));
        }
    }

    private static void putPlain(Map<String, Object> user, String key, String value) {
        if (value != null && !value.isBlank()) {
            user.put(key, value);
        }
    }

    static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
