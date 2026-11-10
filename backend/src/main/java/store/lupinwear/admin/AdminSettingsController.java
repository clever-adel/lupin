package store.lupinwear.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.audit.AuditLog;
import store.lupinwear.content.SiteSettings;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.shared.ApiException;

/**
 * Staff-editable store configuration: delivery options with their fees, and the settings rows.
 * Payment settings decide where customers send money, so only the owner may change them.
 */
@RestController
@RequestMapping("/api/v1/admin")
@PreAuthorize("hasAnyRole('ADMIN','OWNER')")
@Transactional
public class AdminSettingsController {

    public record GovernorateFee(@NotNull Integer governorateId,
            @DecimalMin("0.00") @Digits(integer = 10, fraction = 2) BigDecimal feeOverride) {
    }

    public record DeliveryOptionRequest(
            @NotNull @Pattern(regexp = "STANDARD|EXPRESS|PICKUP") String type,
            @NotBlank @Size(max = 80) String nameEn,
            @NotBlank @Size(max = 80) String nameAr,
            @Size(max = 80) String estimateEn,
            @Size(max = 80) String estimateAr,
            @NotNull @DecimalMin("0.00") @Digits(integer = 10, fraction = 2) BigDecimal fee,
            boolean active,
            int sortOrder,
            /** Empty = offered in every governorate at the fee above. */
            @NotNull @Size(max = 27) List<@Valid GovernorateFee> governorates) {
    }

    public record DeliveryOptionView(int id, String code, String type, String nameEn, String nameAr,
            String estimateEn, String estimateAr, BigDecimal fee, boolean active, int sortOrder,
            List<GovernorateFee> governorates) {
    }

    /** Settings a staff member may edit, and extra fields allowed beyond those already stored. */
    private static final Map<String, Set<String>> EDITABLE = Map.of(
            "hero", Set.of(), "announcement", Set.of(), "contact", Set.of(), "home_sections", Set.of(),
            "checkout", Set.of("unpaidOrderMinutes"), "payment_methods", Set.of());
    private static final Set<String> OWNER_ONLY = Set.of("payment_methods", "checkout");

    private final JdbcClient jdbc;
    private final SiteSettings settings;
    private final AuditLog audit;

    public AdminSettingsController(JdbcClient jdbc, SiteSettings settings, AuditLog audit) {
        this.jdbc = jdbc;
        this.settings = settings;
        this.audit = audit;
    }

    // ── delivery options ──

    @GetMapping("/delivery/options")
    @Transactional(readOnly = true)
    public List<DeliveryOptionView> deliveryOptions() {
        Map<Integer, List<GovernorateFee>> fees = new HashMap<>();
        jdbc.sql("select delivery_option_id, governorate_id, fee_override from delivery_option_governorates"
                + " order by governorate_id").query((rs, n) -> fees
                        .computeIfAbsent(rs.getInt(1), k -> new ArrayList<>())
                        .add(new GovernorateFee(rs.getInt(2), rs.getBigDecimal(3)))).list();
        return jdbc.sql("select id, code, type, name_en, name_ar, estimate_en, estimate_ar, fee, active, sort_order"
                + " from delivery_options order by sort_order, id")
                .query((rs, n) -> new DeliveryOptionView(rs.getInt(1), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getBigDecimal(8),
                        rs.getBoolean(9), rs.getInt(10), fees.getOrDefault(rs.getInt(1), List.of())))
                .list();
    }

    @PostMapping("/delivery/options")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Integer> createDeliveryOption(@AuthenticationPrincipal CurrentUser user,
            @Valid @RequestBody DeliveryOptionRequest body) {
        int id = jdbc.sql("""
                insert into delivery_options (code, type, name_en, name_ar, estimate_en, estimate_ar, fee, active, sort_order)
                values (:code, :type, :en, :ar, :estEn, :estAr, :fee, :active, :ord) returning id
                """).param("code", "opt-" + UUID.randomUUID().toString().substring(0, 12))
                .param("type", body.type()).param("en", body.nameEn().trim()).param("ar", body.nameAr().trim())
                .param("estEn", orEmpty(body.estimateEn())).param("estAr", orEmpty(body.estimateAr()))
                .param("fee", body.fee()).param("active", body.active()).param("ord", body.sortOrder())
                .query(Integer.class).single();
        replaceGovernorates(id, body.governorates());
        audit.record(user.id(), "DELIVERY_OPTION_CREATE", "delivery_option", id, body);
        return Map.of("id", id);
    }

    @PutMapping("/delivery/options/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void updateDeliveryOption(@AuthenticationPrincipal CurrentUser user, @PathVariable int id,
            @Valid @RequestBody DeliveryOptionRequest body) {
        int rows = jdbc.sql("""
                update delivery_options set type = :type, name_en = :en, name_ar = :ar, estimate_en = :estEn,
                       estimate_ar = :estAr, fee = :fee, active = :active, sort_order = :ord, updated_at = now()
                where id = :id
                """).param("type", body.type()).param("en", body.nameEn().trim()).param("ar", body.nameAr().trim())
                .param("estEn", orEmpty(body.estimateEn())).param("estAr", orEmpty(body.estimateAr()))
                .param("fee", body.fee()).param("active", body.active()).param("ord", body.sortOrder())
                .param("id", id).update();
        if (rows == 0) {
            throw ApiException.notFound("Delivery option");
        }
        replaceGovernorates(id, body.governorates());
        audit.record(user.id(), "DELIVERY_OPTION_UPDATE", "delivery_option", id, body);
    }

    private void replaceGovernorates(int optionId, List<GovernorateFee> governorates) {
        Set<Integer> seen = new HashSet<>();
        jdbc.sql("delete from delivery_option_governorates where delivery_option_id = :o").param("o", optionId)
                .update();
        for (GovernorateFee g : governorates) {
            boolean known = jdbc.sql("select count(*) from governorates where id = :g").param("g", g.governorateId())
                    .query(Long.class).single() == 1;
            if (!known || !seen.add(g.governorateId())) {
                throw ApiException.badRequest("UNKNOWN_GOVERNORATE", "Each governorate can be listed once.");
            }
            jdbc.sql("insert into delivery_option_governorates values (:o, :g, :fee)").param("o", optionId)
                    .param("g", g.governorateId()).param("fee", g.feeOverride()).update();
        }
    }

    // ── settings ──

    @GetMapping("/settings")
    @Transactional(readOnly = true)
    public Map<String, JsonNode> settings() {
        Map<String, JsonNode> all = new LinkedHashMap<>();
        EDITABLE.keySet().stream().sorted().forEach(key -> all.put(key, settings.get(key)));
        return all;
    }

    /**
     * Changes fields of one setting. Only fields that already exist (plus a short allow-list) can be
     * set, and only with a value of the same kind, so a typo cannot add junk or break a reader.
     */
    @PutMapping("/settings/{key}")
    public JsonNode updateSetting(@AuthenticationPrincipal CurrentUser user, @PathVariable String key,
            @RequestBody JsonNode body) {
        if (!EDITABLE.containsKey(key) || !body.isObject()) {
            throw ApiException.notFound("Setting");
        }
        if (OWNER_ONLY.contains(key) && !user.roles().contains("OWNER")) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Only the owner can change this setting.");
        }
        ObjectNode merged = ((ObjectNode) settings.get(key)).deepCopy();
        for (Map.Entry<String, JsonNode> field : body.properties()) {
            JsonNode current = merged.get(field.getKey());
            JsonNode value = field.getValue();
            boolean extra = current == null && EDITABLE.get(key).contains(field.getKey());
            if ((current == null && !extra) || !acceptable(current, value)) {
                throw ApiException.badRequest("INVALID_SETTING", "Field '" + field.getKey() + "' cannot be set like that.");
            }
            merged.set(field.getKey(), value);
        }
        validate(key, merged);
        jdbc.sql("update site_settings set value = cast(:v as jsonb), updated_by = :u, updated_at = now() where key = :k")
                .param("v", merged.toString()).param("u", user.id()).param("k", key).update();
        audit.record(user.id(), "SETTING_UPDATE", "setting", key, body);
        return merged;
    }

    private static boolean acceptable(JsonNode current, JsonNode value) {
        if (value.isTextual()) {
            return value.asText().length() <= 500 && (current == null || current.isTextual() || current.isNull());
        }
        if (value.isBoolean()) {
            return current != null && current.isBoolean();
        }
        if (value.isNumber() || value.isNull()) {
            return current == null || current.isNumber() || current.isNull();
        }
        if (value.isArray()) {
            if (current == null || !current.isArray() || value.size() > 10) {
                return false;
            }
            for (JsonNode item : value) {
                if (!item.isTextual() || item.asText().length() > 200) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    private static void validate(String key, ObjectNode value) {
        if ("checkout".equals(key)) {
            requireRange(value, "cancelUndoMinutes", 0, 24 * 60, false);
            requireRange(value, "unpaidOrderMinutes", 10, 7 * 24 * 60, true);
            requireRange(value, "freeDeliveryThreshold", 1, 1_000_000, true);
            if (!value.path("orderReferencePrefix").asText().matches("[A-Z]{1,6}")) {
                throw ApiException.badRequest("INVALID_SETTING", "The order prefix is 1 to 6 capital letters.");
            }
        }
        if ("payment_methods".equals(key) && value.path("INSTAPAY_MANUAL").asBoolean()
                && value.path("instapayHandle").asText("").isBlank()) {
            throw ApiException.badRequest("INVALID_SETTING", "Enter the InstaPay address before switching InstaPay on.");
        }
    }

    private static void requireRange(ObjectNode value, String field, long min, long max, boolean optional) {
        JsonNode node = value.get(field);
        if (node == null || node.isNull()) {
            if (optional) {
                return;
            }
            throw ApiException.badRequest("INVALID_SETTING", field + " is required.");
        }
        BigInteger whole = node.isIntegralNumber() ? node.bigIntegerValue() : null;
        boolean decimalOk = "freeDeliveryThreshold".equals(field) && node.isNumber();
        long v = whole != null ? whole.longValue() : decimalOk ? node.decimalValue().longValue() : Long.MIN_VALUE;
        if (v < min || v > max) {
            throw ApiException.badRequest("INVALID_SETTING", field + " must be between " + min + " and " + max + ".");
        }
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s.trim();
    }
}
