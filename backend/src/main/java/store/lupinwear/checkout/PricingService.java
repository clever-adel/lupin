package store.lupinwear.checkout;

import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import store.lupinwear.cart.CartService;
import store.lupinwear.cart.CartService.Line;
import store.lupinwear.cart.CartService.LineView;
import store.lupinwear.content.SiteSettings;
import store.lupinwear.delivery.DeliveryService;
import store.lupinwear.delivery.DeliveryService.GovernorateView;
import store.lupinwear.delivery.DeliveryService.OptionView;

/**
 * The only place totals are computed. The browser sends what the customer chose (governorate, delivery
 * option, promo code); every amount comes from the database.
 *
 * Rules (DECISIONS.md D-27, D-28):
 *  - one item discount per order: the larger of the best automatic promotion and the entered code;
 *  - free delivery is separate and can combine with an item discount: it comes from a free-delivery
 *    promotion or from the free-delivery threshold, compared with the subtotal after discount;
 *  - a code that is not the discount actually used is not consumed.
 */
@Service
@Transactional(readOnly = true)
public class PricingService {

    public record QuoteRequest(Integer governorateId, Integer deliveryOptionId, @Size(max = 30) String promoCode) {
    }

    public record Issue(String code, Long variantId, String message) {
    }

    public record PromoResult(String code, boolean applied, String reason) {
    }

    public record DeliveryView(int optionId, String nameEn, String nameAr, String estimateEn, String estimateAr,
            BigDecimal listFee, BigDecimal fee, boolean free) {
    }

    public record QuoteView(List<LineView> lines, BigDecimal subtotal, BigDecimal discount, String discountLabelEn,
            String discountLabelAr, PromoResult promo, DeliveryView delivery, BigDecimal total, List<Issue> issues,
            boolean readyToOrder) {
    }

    /** The quote plus what order placement needs to snapshot. */
    public record Quote(QuoteView view, List<Line> lines, Long promoCodeId, String promoCode,
            GovernorateView governorate, OptionView option) {
    }

    private record Promotion(long id, String nameEn, String nameAr, String type, BigDecimal value, String scope,
            BigDecimal minOrder, Set<Long> targets, boolean active, OffsetDateTime startsAt, OffsetDateTime endsAt,
            Long codeId, String code, Integer maxRedemptions, int perCustomerLimit, int redeemedCount) {

        boolean freeDelivery() {
            return "FREE_DELIVERY".equals(type);
        }
    }

    private static final String PROMOTION = """
            select p.id, p.name_en, p.name_ar, p.type, p.value, p.scope, p.min_order_value, p.active,
                   p.starts_at, p.ends_at,
                   array(select t.target_id from promotion_targets t where t.promotion_id = p.id) as targets,
                   pc.id as code_id, pc.code, pc.max_redemptions, pc.per_customer_limit, pc.redeemed_count
            from promotions p left join promo_codes pc on pc.promotion_id = p.id
            """;

    private final JdbcClient jdbc;
    private final CartService cart;
    private final DeliveryService delivery;
    private final SiteSettings settings;
    private final Clock clock;

    public PricingService(JdbcClient jdbc, CartService cart, DeliveryService delivery, SiteSettings settings,
            Clock clock) {
        this.jdbc = jdbc;
        this.cart = cart;
        this.delivery = delivery;
        this.settings = settings;
        this.clock = clock;
    }

    public Quote quote(UUID user, QuoteRequest request) {
        List<Line> lines = cart.lines(user);
        List<Issue> issues = new ArrayList<>();
        if (lines.isEmpty()) {
            issues.add(new Issue("EMPTY_BAG", null, "Your bag is empty."));
        }
        for (Line line : lines) {
            if (!line.purchasable()) {
                issues.add(new Issue("UNAVAILABLE", line.variantId(), "This item is no longer available."));
            } else if (line.quantity() > line.available()) {
                issues.add(new Issue("INSUFFICIENT_STOCK", line.variantId(), line.available() == 0
                        ? "This size is sold out."
                        : "Only " + Math.min(line.available(), line.view().maxQuantity()) + " available."));
            }
        }

        BigDecimal subtotal = CartService.subtotal(lines);
        OffsetDateTime now = OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);

        // Automatic promotions that apply right now.
        Promotion bestAutomatic = null;
        BigDecimal bestAutomaticAmount = BigDecimal.ZERO;
        boolean freeDelivery = false;
        for (Promotion p : automaticPromotions(now)) {
            if (subtotal.compareTo(p.minOrder()) < 0 || eligible(p, lines).signum() == 0) {
                continue;
            }
            if (p.freeDelivery()) {
                freeDelivery = true;
            } else {
                BigDecimal amount = amount(p, lines);
                if (amount.compareTo(bestAutomaticAmount) > 0) {
                    bestAutomatic = p;
                    bestAutomaticAmount = amount;
                }
            }
        }

        // The entered code, if any.
        Promotion applied = bestAutomatic;
        BigDecimal discount = bestAutomaticAmount;
        PromoResult promo = null;
        Promotion usedCode = null;
        String entered = request.promoCode() == null ? "" : request.promoCode().trim().toUpperCase(Locale.ROOT);
        if (!entered.isEmpty()) {
            Optional<Promotion> found = byCode(entered);
            // Not Optional.map: a null result means "accepted" and must not turn into NOT_FOUND.
            String reason = found.isEmpty() ? "NOT_FOUND" : rejection(found.get(), user, now, subtotal, lines);
            if (reason == null) {
                Promotion code = found.get();
                if (code.freeDelivery()) {
                    freeDelivery = true;
                    usedCode = code;
                } else {
                    BigDecimal amount = amount(code, lines);
                    if (amount.compareTo(bestAutomaticAmount) >= 0) {
                        applied = code;
                        discount = amount;
                        usedCode = code;
                    } else {
                        reason = "BETTER_OFFER_APPLIED";
                    }
                }
            }
            promo = new PromoResult(entered, reason == null, reason);
        }

        // Delivery.
        GovernorateView governorate = request.governorateId() == null ? null
                : delivery.governorate(request.governorateId()).orElse(null);
        OptionView option = governorate == null || request.deliveryOptionId() == null ? null
                : delivery.option(governorate.id(), request.deliveryOptionId()).orElse(null);
        if (request.governorateId() != null && request.deliveryOptionId() != null && option == null) {
            issues.add(new Issue("DELIVERY_UNAVAILABLE", null, "This delivery option is not available there."));
        }
        DeliveryView deliveryView = null;
        BigDecimal fee = BigDecimal.ZERO;
        if (option != null) {
            BigDecimal threshold = settings.freeDeliveryThreshold();
            boolean free = freeDelivery
                    || (threshold != null && subtotal.signum() > 0
                            && subtotal.subtract(discount).compareTo(threshold) >= 0);
            fee = free ? BigDecimal.ZERO.setScale(2) : option.fee();
            deliveryView = new DeliveryView(option.id(), option.nameEn(), option.nameAr(), option.estimateEn(),
                    option.estimateAr(), option.fee(), fee, free);
        }

        BigDecimal total = subtotal.subtract(discount).add(fee);
        QuoteView view = new QuoteView(lines.stream().map(Line::view).toList(), subtotal, discount,
                applied == null ? "" : applied.nameEn(), applied == null ? "" : applied.nameAr(), promo, deliveryView,
                total, issues, issues.isEmpty() && option != null);
        return new Quote(view, lines, usedCode == null ? null : usedCode.codeId(),
                usedCode == null ? null : usedCode.code(), governorate, option);
    }

    /** Null when the code can be used by this customer on this bag. */
    private String rejection(Promotion p, UUID user, OffsetDateTime now, BigDecimal subtotal, List<Line> lines) {
        if (!p.active() || (p.startsAt() != null && p.startsAt().isAfter(now))
                || (p.endsAt() != null && !p.endsAt().isAfter(now))) {
            return "NOT_ACTIVE";
        }
        if (p.maxRedemptions() != null && p.redeemedCount() >= p.maxRedemptions()) {
            return "USED_UP";
        }
        long usedByCustomer = jdbc.sql("select count(*) from promo_code_redemptions"
                + " where promo_code_id = :c and user_id = :u and status <> 'RELEASED'")
                .param("c", p.codeId()).param("u", user).query(Long.class).single();
        if (usedByCustomer >= p.perCustomerLimit()) {
            return "ALREADY_USED";
        }
        if (subtotal.compareTo(p.minOrder()) < 0) {
            return "MIN_ORDER";
        }
        if (eligible(p, lines).signum() == 0) {
            return "NOT_ELIGIBLE";
        }
        return null;
    }

    private static BigDecimal eligible(Promotion p, List<Line> lines) {
        return lines.stream().filter(Line::purchasable).filter(l -> switch (p.scope()) {
            case "DEPARTMENT" -> p.targets().contains((long) l.departmentId());
            case "CATEGORY" -> p.targets().contains((long) l.categoryId());
            case "COLLECTION" -> l.collectionId() != null && p.targets().contains((long) l.collectionId());
            case "PRODUCT" -> p.targets().contains(l.productId());
            default -> true;
        }).map(Line::lineTotal).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static BigDecimal amount(Promotion p, List<Line> lines) {
        BigDecimal eligible = eligible(p, lines);
        BigDecimal amount = switch (p.type()) {
            case "PERCENT" -> eligible.multiply(p.value()).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
            case "FIXED" -> p.value().min(eligible);
            default -> BigDecimal.ZERO;
        };
        return amount.setScale(2, RoundingMode.HALF_UP);
    }

    private List<Promotion> automaticPromotions(OffsetDateTime now) {
        return jdbc.sql(PROMOTION + """
                where p.automatic and p.active
                  and (p.starts_at is null or p.starts_at <= :now) and (p.ends_at is null or p.ends_at > :now)
                order by p.id
                """).param("now", now).query(PricingService::map).list();
    }

    private Optional<Promotion> byCode(String code) {
        return jdbc.sql(PROMOTION + " where pc.code = :code").param("code", code).query(PricingService::map)
                .optional();
    }

    private static Promotion map(ResultSet rs, int n) throws SQLException {
        Object[] raw = (Object[]) rs.getArray("targets").getArray();
        Set<Long> targets = new HashSet<>();
        Arrays.stream(raw).forEach(t -> targets.add(((Number) t).longValue()));
        return new Promotion(rs.getLong("id"), rs.getString("name_en"), rs.getString("name_ar"),
                rs.getString("type"), rs.getBigDecimal("value"), rs.getString("scope"),
                rs.getBigDecimal("min_order_value"), targets, rs.getBoolean("active"),
                rs.getObject("starts_at", OffsetDateTime.class), rs.getObject("ends_at", OffsetDateTime.class),
                (Long) rs.getObject("code_id"), rs.getString("code"), (Integer) rs.getObject("max_redemptions"),
                rs.getInt("per_customer_limit"), rs.getInt("redeemed_count"));
    }
}
