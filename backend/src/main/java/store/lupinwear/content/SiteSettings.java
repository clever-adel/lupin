package store.lupinwear.content;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.math.BigDecimal;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Owner-editable settings stored as JSON rows. Read on demand; the table is tiny. */
@Service
public class SiteSettings {

    private final JdbcClient jdbc;
    private final ObjectMapper json;

    public SiteSettings(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public JsonNode get(String key) {
        return jdbc.sql("select value::text from site_settings where key = :k").param("k", key)
                .query(String.class).optional().map(this::parse).orElse(MissingNode.getInstance());
    }

    public String orderReferencePrefix() {
        String prefix = get("checkout").path("orderReferencePrefix").asText("LP");
        return prefix.matches("[A-Z]{1,6}") ? prefix : "LP";
    }

    public int cancelUndoMinutes() {
        return Math.clamp(get("checkout").path("cancelUndoMinutes").asInt(30), 0, 24 * 60);
    }

    /** How long an online-payment order may stay unpaid before its stock is released. */
    public int unpaidOrderMinutes() {
        return Math.clamp(get("checkout").path("unpaidOrderMinutes").asInt(60), 10, 7 * 24 * 60);
    }

    /** Null means there is no free-delivery threshold. */
    public BigDecimal freeDeliveryThreshold() {
        JsonNode node = get("checkout").path("freeDeliveryThreshold");
        return node.isNumber() && node.decimalValue().signum() > 0 ? node.decimalValue() : null;
    }

    public boolean paymentMethodEnabled(String method) {
        return get("payment_methods").path(method).asBoolean(false);
    }

    private JsonNode parse(String raw) {
        try {
            return json.readTree(raw);
        } catch (JsonProcessingException e) {
            return MissingNode.getInstance();
        }
    }
}
