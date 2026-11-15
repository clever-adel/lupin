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

    public static final List<String> ALL =
            List.of("COD", "CARD", "WALLET", "FAWRY", "INSTAPAY_MANUAL", "VODAFONE_CASH_MANUAL");
    public static final List<String> PAYMOB = List.of("CARD", "WALLET", "FAWRY");
    /** Paid by the customer sending money themselves; staff confirm each transfer in the dashboard. */
    public static final List<String> MANUAL = List.of("INSTAPAY_MANUAL", "VODAFONE_CASH_MANUAL");

    /** {@code link}: optional InstaPay payment link (https://ipn.eg/...); {@code qrUrl}: optional uploaded QR image. */
    public record Instapay(String handle, String instructionsEn, String instructionsAr, String link, String qrUrl) {
    }

    public record VodafoneCash(String number, String instructionsEn, String instructionsAr) {
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
                config.path("instapayInstructionsEn").asText(""), config.path("instapayInstructionsAr").asText(""),
                config.path("instapayLink").asText("").trim(), config.path("instapayQrUrl").asText("").trim()));
    }

    /** Present only while manual Vodafone Cash is usable; shown to customers so they know where to send money. */
    public Optional<VodafoneCash> vodafoneCash() {
        JsonNode config = settings.get("payment_methods");
        if (!available("VODAFONE_CASH_MANUAL", config)) {
            return Optional.empty();
        }
        return Optional.of(new VodafoneCash(config.path("vodafoneCashNumber").asText().trim(),
                config.path("vodafoneCashInstructionsEn").asText(""),
                config.path("vodafoneCashInstructionsAr").asText("")));
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
        if ("VODAFONE_CASH_MANUAL".equals(method)) {
            return !config.path("vodafoneCashNumber").asText("").isBlank();
        }
        return true;
    }
}
