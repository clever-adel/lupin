package store.lupinwear.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
import store.lupinwear.security.CurrentUser;
import store.lupinwear.shared.ApiException;

/**
 * Offers. A promotion is either automatic (applies by itself) or tied to exactly one promo code.
 * How they combine at checkout is decided in PricingService, not here.
 */
@RestController
@RequestMapping("/api/v1/admin/promotions")
@PreAuthorize("hasAnyRole('ADMIN','OWNER')")
@Transactional
public class AdminPromotionController {

    public record PromotionRequest(
            @NotBlank @Size(max = 120) String nameEn,
            @NotBlank @Size(max = 120) String nameAr,
            boolean automatic,
            @NotNull @Pattern(regexp = "PERCENT|FIXED|FREE_DELIVERY") String type,
            @DecimalMin("0.00") @Digits(integer = 10, fraction = 2) BigDecimal value,
            @NotNull @Pattern(regexp = "ALL|DEPARTMENT|CATEGORY|PRODUCT") String scope,
            @Size(max = 200) List<@NotNull Long> targetIds,
            @DecimalMin("0.00") @Digits(integer = 10, fraction = 2) BigDecimal minOrderValue,
            Instant startsAt,
            Instant endsAt,
            boolean active,
            /** Required when the promotion is not automatic. Cannot be changed later. */
            @Pattern(regexp = "^[A-Za-z0-9-]{3,30}$", message = "Use 3 to 30 letters, numbers or dashes") String code,
            @Min(1) @Max(1_000_000) Integer maxRedemptions,
            @Min(1) @Max(1000) Integer perCustomerLimit) {
    }

    public record PromotionView(long id, String nameEn, String nameAr, boolean automatic, String type,
            BigDecimal value, String scope, List<Long> targetIds, BigDecimal minOrderValue, Instant startsAt,
            Instant endsAt, boolean active, String code, Integer maxRedemptions, Integer perCustomerLimit,
            Integer redeemedCount) {
    }

    public record Target(long id, String name) {
    }

    public record Targets(List<Target> departments, List<Target> categories, List<Target> products) {
    }

    private static final Map<String, String> TARGET_TABLE = Map.of("DEPARTMENT", "departments", "CATEGORY",
            "categories", "PRODUCT", "products");

    private final JdbcClient jdbc;
    private final AuditLog audit;

    public AdminPromotionController(JdbcClient jdbc, AuditLog audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<PromotionView> list() {
        Map<Long, List<Long>> targets = new HashMap<>();
        jdbc.sql("select promotion_id, target_id from promotion_targets order by target_id")
                .query((rs, n) -> targets.computeIfAbsent(rs.getLong(1), k -> new ArrayList<>()).add(rs.getLong(2)))
                .list();
        return jdbc.sql("""
                select p.id, p.name_en, p.name_ar, p.automatic, p.type, p.value, p.scope, p.min_order_value,
                       p.starts_at, p.ends_at, p.active, pc.code, pc.max_redemptions, pc.per_customer_limit,
                       pc.redeemed_count
                from promotions p left join promo_codes pc on pc.promotion_id = p.id
                order by p.active desc, p.id desc limit 300
                """).query((rs, n) -> new PromotionView(rs.getLong("id"), rs.getString("name_en"),
                        rs.getString("name_ar"), rs.getBoolean("automatic"), rs.getString("type"),
                        rs.getBigDecimal("value"), rs.getString("scope"),
                        targets.getOrDefault(rs.getLong("id"), List.of()), rs.getBigDecimal("min_order_value"),
                        instant(rs.getObject("starts_at", OffsetDateTime.class)),
                        instant(rs.getObject("ends_at", OffsetDateTime.class)), rs.getBoolean("active"),
                        rs.getString("code"), (Integer) rs.getObject("max_redemptions"),
                        (Integer) rs.getObject("per_customer_limit"), (Integer) rs.getObject("redeemed_count")))
                .list();
    }

    /** What a promotion can be limited to, for the dashboard's pickers. */
    @GetMapping("/targets")
    @Transactional(readOnly = true)
    public Targets targets() {
        return new Targets(
                targetList("select id, name_en from departments order by sort_order, id"),
                targetList("select c.id, d.name_en || ' › ' || c.name_en from categories c"
                        + " join departments d on d.id = c.department_id where c.active order by d.sort_order, c.sort_order, c.id"),
                targetList("select id, name_en from products where deleted_at is null and status <> 'ARCHIVED'"
                        + " order by name_en limit 500"));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Long> create(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody PromotionRequest body) {
        validate(body);
        String code = body.automatic() ? null : body.code().toUpperCase(Locale.ROOT);
        if (code != null && jdbc.sql("select count(*) from promo_codes where code = :c").param("c", code)
                .query(Long.class).single() > 0) {
            throw ApiException.conflict("CODE_EXISTS", "This promo code already exists.");
        }
        long id = jdbc.sql("""
                insert into promotions (name_en, name_ar, automatic, type, value, scope, min_order_value, starts_at,
                                        ends_at, active)
                values (:en, :ar, :auto, :type, :value, :scope, :min, :starts, :ends, :active) returning id
                """).param("en", body.nameEn().trim()).param("ar", body.nameAr().trim())
                .param("auto", body.automatic()).param("type", body.type()).param("value", value(body))
                .param("scope", body.scope()).param("min", orZero(body.minOrderValue()))
                .param("starts", time(body.startsAt())).param("ends", time(body.endsAt()))
                .param("active", body.active()).query(Long.class).single();
        replaceTargets(id, body);
        if (code != null) {
            jdbc.sql("insert into promo_codes (code, promotion_id, max_redemptions, per_customer_limit)"
                    + " values (:c, :p, :max, :per)").param("c", code).param("p", id)
                    .param("max", body.maxRedemptions())
                    .param("per", body.perCustomerLimit() == null ? 1 : body.perCustomerLimit()).update();
        }
        audit.record(user.id(), "PROMOTION_CREATE", "promotion", id, body);
        return Map.of("id", id);
    }

    /** Everything can be edited except whether it is automatic and the code text itself. */
    @PutMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void update(@AuthenticationPrincipal CurrentUser user, @PathVariable long id,
            @Valid @RequestBody PromotionRequest body) {
        boolean automatic = jdbc.sql("select automatic from promotions where id = :id for update").param("id", id)
                .query(Boolean.class).optional().orElseThrow(() -> ApiException.notFound("Promotion"));
        if (automatic != body.automatic()) {
            throw ApiException.badRequest("CANNOT_CHANGE_KIND",
                    "An offer cannot be switched between automatic and promo code. Create a new one.");
        }
        validate(body);
        jdbc.sql("""
                update promotions set name_en = :en, name_ar = :ar, type = :type, value = :value, scope = :scope,
                       min_order_value = :min, starts_at = :starts, ends_at = :ends, active = :active, updated_at = now()
                where id = :id
                """).param("en", body.nameEn().trim()).param("ar", body.nameAr().trim()).param("type", body.type())
                .param("value", value(body)).param("scope", body.scope()).param("min", orZero(body.minOrderValue()))
                .param("starts", time(body.startsAt())).param("ends", time(body.endsAt()))
                .param("active", body.active()).param("id", id).update();
        replaceTargets(id, body);
        if (!automatic) {
            int rows = jdbc.sql("""
                    update promo_codes set max_redemptions = :max, per_customer_limit = :per
                    where promotion_id = :p and (cast(:max as int) is null or redeemed_count <= :max)
                    """).param("max", body.maxRedemptions())
                    .param("per", body.perCustomerLimit() == null ? 1 : body.perCustomerLimit()).param("p", id)
                    .update();
            if (rows == 0) {
                throw ApiException.badRequest("LIMIT_BELOW_USED",
                        "The total limit cannot be lower than the number of times the code was already used.");
            }
        }
        audit.record(user.id(), "PROMOTION_UPDATE", "promotion", id, body);
    }

    private void validate(PromotionRequest body) {
        BigDecimal value = body.value() == null ? BigDecimal.ZERO : body.value();
        if ("PERCENT".equals(body.type()) && (value.signum() <= 0 || value.compareTo(BigDecimal.valueOf(90)) > 0)) {
            throw ApiException.badRequest("INVALID_VALUE", "A percentage offer must be between 1 and 90.");
        }
        if ("FIXED".equals(body.type()) && value.signum() <= 0) {
            throw ApiException.badRequest("INVALID_VALUE", "Enter the amount to take off.");
        }
        if (body.startsAt() != null && body.endsAt() != null && !body.endsAt().isAfter(body.startsAt())) {
            throw ApiException.badRequest("INVALID_DATES", "The end must be after the start.");
        }
        if (!body.automatic() && (body.code() == null || body.code().isBlank())) {
            throw ApiException.badRequest("CODE_REQUIRED", "Enter the promo code customers will type.");
        }
        List<Long> targets = body.targetIds() == null ? List.of() : body.targetIds();
        if ("ALL".equals(body.scope()) != targets.isEmpty()) {
            throw ApiException.badRequest("INVALID_TARGETS", "ALL".equals(body.scope())
                    ? "An offer on everything cannot list specific items."
                    : "Choose what this offer applies to.");
        }
        if (!targets.isEmpty()) {
            // Table name comes from a fixed map, never from the request.
            long known = jdbc.sql("select count(*) from " + TARGET_TABLE.get(body.scope()) + " where id in (:ids)")
                    .param("ids", targets).query(Long.class).single();
            if (known != targets.stream().distinct().count()) {
                throw ApiException.badRequest("INVALID_TARGETS", "One of the chosen items does not exist.");
            }
        }
    }

    private void replaceTargets(long id, PromotionRequest body) {
        jdbc.sql("delete from promotion_targets where promotion_id = :p").param("p", id).update();
        if (body.targetIds() != null) {
            body.targetIds().stream().distinct().forEach(t -> jdbc
                    .sql("insert into promotion_targets values (:p, :t)").param("p", id).param("t", t).update());
        }
    }

    private List<Target> targetList(String sql) {
        return jdbc.sql(sql).query((rs, n) -> new Target(rs.getLong(1), rs.getString(2))).list();
    }

    private static BigDecimal value(PromotionRequest body) {
        return "FREE_DELIVERY".equals(body.type()) || body.value() == null ? BigDecimal.ZERO : body.value();
    }

    private static BigDecimal orZero(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }

    private static OffsetDateTime time(Instant instant) {
        return instant == null ? null : OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private static Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }
}
