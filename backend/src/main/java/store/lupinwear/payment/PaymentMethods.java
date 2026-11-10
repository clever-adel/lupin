package store.lupinwear.payment;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;
import store.lupinwear.content.SiteSettings;

/**
 * Which payment methods a customer can actually use right now. A method needs the owner's switch in
 * settings AND whatever makes it work: Paymob keys + integration id for online methods, an InstaPay
 * address for manual transfer.
 */
@Service
public class PaymentMethods {

    public static final List<String> ALL = List.of("COD", "CARD", "WALLET", "FAWRY", "INSTAPAY_MANUAL");
    public static final List<String> PAYMOB = List.of("CARD", "WALLET", "FAWRY");

    public record Instapay(String handle, String instructionsEn, String instructionsAr) {
    }

    private final SiteSettings settings;
    private final PaymobProperties paymob;

    public PaymentMethods(SiteSettings settings, PaymobProperties paymob) {
        this.settings = settings;
        this.paymob = paymob;
    }

    public boolean available(String method) {
        return available(method, settings.get("payment_methods"));
    }

    public Map<String, Boolean> all() {
        JsonNode config = settings.get("payment_methods");
        Map<String, Boolean> result = new LinkedHashMap<>();
        ALL.forEach(m -> result.put(m, available(m, config)));
        return result;
    }

    /** Present only while manual InstaPay is usable; shown to customers so they know where to send money. */
    public Optional<Instapay> instapay() {
        JsonNode config = settings.get("payment_methods");
        if (!available("INSTAPAY_MANUAL", config)) {
            return Optional.empty();
        }
        return Optional.of(new Instapay(config.path("instapayHandle").asText().trim(),
                config.path("instapayInstructionsEn").asText(""), config.path("instapayInstructionsAr").asText("")));
    }

    private boolean available(String method, JsonNode config) {
        if (!ALL.contains(method) || !config.path(method).asBoolean(false)) {
            return false;
        }
        if (PAYMOB.contains(method)) {
            return paymob.integrationFor(method) != null;
        }
        if ("INSTAPAY_MANUAL".equals(method)) {
            return !config.path("instapayHandle").asText("").isBlank();
        }
        return true;
    }
}
