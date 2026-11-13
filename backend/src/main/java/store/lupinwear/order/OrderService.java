package store.lupinwear.order;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import store.lupinwear.cart.CartService;
import store.lupinwear.cart.CartService.Line;
import store.lupinwear.checkout.PricingService;
import store.lupinwear.checkout.PricingService.Quote;
import store.lupinwear.checkout.PricingService.QuoteRequest;
import store.lupinwear.content.SiteSettings;
import store.lupinwear.payment.PaymentMethods;
import store.lupinwear.shared.ApiException;
import store.lupinwear.shared.PageResponse;

/**
 * Order placement and the customer's own cancel / undo.
 *
 * Stock is never oversold: each line is reserved with one conditional UPDATE that only succeeds while
 * enough unreserved stock exists, and everything runs in one transaction, so a failed line rolls the
 * whole order back.
 */
@Service
@Transactional
public class OrderService {

    public record PlaceOrderRequest(
            @NotBlank @Size(min = 2, max = 120) String recipientName,
            @NotBlank @Pattern(regexp = "^01[0125][0-9]{8}$", message = "Enter an Egyptian mobile number, e.g. 01012345678")
            String phone,
            @NotNull Integer governorateId,
            @NotBlank @Size(max = 80) String city,
            @NotBlank @Size(min = 5, max = 300) String addressLine,
            @Size(max = 300) String notes,
            @NotNull Integer deliveryOptionId,
            @Size(max = 30) String promoCode,
            @NotBlank @Pattern(regexp = "COD|CARD|WALLET|FAWRY|INSTAPAY_MANUAL") String paymentMethod,
            @NotNull @DecimalMin("0.00") @Digits(integer = 10, fraction = 2) BigDecimal expectedTotal,
            @NotBlank @Size(min = 8, max = 80) @Pattern(regexp = "^[A-Za-z0-9_-]+$") String idempotencyKey) {
    }

    public record ItemView(String productNameEn, String productNameAr, String colorEn, String colorAr,
            String sizeCode, String imageUrl, BigDecimal unitPrice, int quantity, BigDecimal lineTotal) {
    }

    public record HistoryView(String status, Instant at) {
    }

    public record OrderView(String reference, String status, String paymentStatus, String paymentMethod,
            BigDecimal subtotal, BigDecimal discountTotal, String discountLabelEn, String discountLabelAr,
            String promoCode, BigDecimal deliveryFee, BigDecimal total, String customerName, String customerPhone,
            String governorateEn, String governorateAr, String city, String addressLine, String deliveryNotes,
            String deliveryNameEn, String deliveryNameAr, String deliveryEstimateEn, String deliveryEstimateAr,
            Instant placedAt, Instant cancelledAt, Instant undoExpiresAt, boolean canCancel, boolean canUndo,
            String paymentAction, String transferReference, List<ItemView> items, List<HistoryView> history,
            String carrier, String trackingNumber) {
    }

    public record OrderSummary(String reference, String status, BigDecimal total, Instant placedAt, int itemCount) {
    }

    /** A customer may cancel on their own only before the order is being prepared and before money has moved. */
    private static final Set<String> CANCELLABLE = Set.of("PENDING", "AWAITING_PAYMENT", "CONFIRMED");
    private static final Set<String> UNPAID = Set.of("PENDING", "NOT_REQUIRED", "FAILED");

    record Head(UUID id, String status, String paymentStatus, String statusBeforeCancel,
            Instant undoExpiresAt) {
    }

    record Reserved(Long variantId, int quantity) {
    }

    private final JdbcClient jdbc;
    private final PricingService pricing;
    private final CartService cart;
    private final SiteSettings settings;
    private final Clock clock;
    private final PaymentMethods paymentMethods;

    public OrderService(JdbcClient jdbc, PricingService pricing, CartService cart, SiteSettings settings,
            Clock clock, PaymentMethods paymentMethods) {
        this.paymentMethods = paymentMethods;
        this.jdbc = jdbc;
        this.pricing = pricing;
        this.cart = cart;
        this.settings = settings;
        this.clock = clock;
    }

    public OrderView place(UUID user, PlaceOrderRequest req) {
        // One order placement per customer at a time: makes the retry check below race-free.
        jdbc.sql("select pg_advisory_xact_lock(hashtextextended(:u, 0))").param("u", user.toString())
                .query((rs, n) -> 0).list();
        Optional<String> already = jdbc.sql("select reference from orders where user_id = :u and idempotency_key = :k")
                .param("u", user).param("k", req.idempotencyKey()).query(String.class).optional();
        if (already.isPresent()) {
            return get(user, already.get());
        }

        // Nothing is ever marked paid here: cash is collected on delivery, everything else waits for
        // Paymob's signed webhook or a staff member's check of the transfer.
        if (!paymentMethods.available(req.paymentMethod())) {
            throw ApiException.badRequest("PAYMENT_METHOD_UNAVAILABLE", "This payment method is not available.");
        }
        boolean cash = "COD".equals(req.paymentMethod());

        Quote quote = pricing.quote(user,
                new QuoteRequest(req.governorateId(), req.deliveryOptionId(), req.promoCode()));
        var priced = quote.view();
        if (quote.option() == null || quote.governorate() == null) {
            throw ApiException.badRequest("DELIVERY_UNAVAILABLE", "This delivery option is not available there.");
        }
        if (!priced.issues().isEmpty()) {
            throw ApiException.conflict("BAG_CHANGED", priced.issues().get(0).message());
        }
        if (priced.total().compareTo(req.expectedTotal()) != 0) {
            throw ApiException.conflict("PRICE_CHANGED", "The total has changed. Please review your order.");
        }

        // Fixed lock order (variant id) so two orders with the same items cannot deadlock.
        List<Line> lines = quote.lines().stream().sorted(Comparator.comparingLong(Line::variantId)).toList();
        for (Line line : lines) {
            if (!reserve(line.variantId(), line.quantity())) {
                throw ApiException.conflict("OUT_OF_STOCK",
                        line.nameEn() + " (" + line.sizeCode() + ") has just sold out.");
            }
        }
        if (quote.promoCodeId() != null) {
            takePromoCode(quote.promoCodeId(), user);
        }

        OffsetDateTime now = now();
        long sequence = jdbc.sql("select nextval('order_reference_seq')").query(Long.class).single();
        String reference = settings.orderReferencePrefix() + "-" + sequence;
        UUID orderId = jdbc.sql("""
                insert into orders (reference, user_id, status, payment_status, payment_method, subtotal,
                        discount_total, discount_label_en, discount_label_ar, delivery_fee, total, promo_code_id,
                        promo_code, customer_name, customer_phone, governorate_id, governorate_name,
                        governorate_name_ar, city, address_line, delivery_notes, delivery_option_id,
                        delivery_option_name, delivery_option_name_ar, delivery_estimate, delivery_estimate_ar,
                        idempotency_key, placed_at, updated_at)
                values (:ref, :user, :status, 'PENDING', :method, :subtotal, :discount, :labelEn, :labelAr, :fee,
                        :total, :codeId, :code, :name, :phone, :govId, :govEn, :govAr, :city, :address, :notes,
                        :optId, :optEn, :optAr, :estEn, :estAr, :key, :now, :now)
                returning id
                """)
                .param("ref", reference).param("user", user).param("method", req.paymentMethod())
                .param("status", cash ? "PENDING" : "AWAITING_PAYMENT")
                .param("subtotal", priced.subtotal()).param("discount", priced.discount())
                .param("labelEn", priced.discount().signum() > 0 ? priced.discountLabelEn() : "")
                .param("labelAr", priced.discount().signum() > 0 ? priced.discountLabelAr() : "")
                .param("fee", priced.delivery().fee()).param("total", priced.total())
                .param("codeId", quote.promoCodeId()).param("code", quote.promoCode())
                .param("name", req.recipientName().trim()).param("phone", req.phone())
                .param("govId", quote.governorate().id()).param("govEn", quote.governorate().nameEn())
                .param("govAr", quote.governorate().nameAr()).param("city", req.city().trim())
                .param("address", req.addressLine().trim())
                .param("notes", req.notes() == null || req.notes().isBlank() ? null : req.notes().trim())
                .param("optId", quote.option().id()).param("optEn", quote.option().nameEn())
                .param("optAr", quote.option().nameAr()).param("estEn", quote.option().estimateEn())
                .param("estAr", quote.option().estimateAr()).param("key", req.idempotencyKey()).param("now", now)
                .query(UUID.class).single();

        for (Line line : quote.lines()) {
            jdbc.sql("""
                    insert into order_items (order_id, variant_id, product_id, product_name, product_name_ar,
                            color_name, color_name_ar, size_code, sku, image_url, unit_price, quantity, line_total)
                    values (:o, :v, :p, :nameEn, :nameAr, :colorEn, :colorAr, :size, :sku, :image, :price, :q, :total)
                    """)
                    .param("o", orderId).param("v", line.variantId()).param("p", line.productId())
                    .param("nameEn", line.nameEn()).param("nameAr", line.nameAr())
                    .param("colorEn", line.colorEn()).param("colorAr", line.colorAr())
                    .param("size", line.sizeCode()).param("sku", line.sku()).param("image", line.imageUrl())
                    .param("price", line.unitPrice()).param("q", line.quantity()).param("total", line.lineTotal())
                    .update();
            movement(line.variantId(), "RESERVE", line.quantity(), reference, user);
        }
        if (quote.promoCodeId() != null) {
            jdbc.sql("insert into promo_code_redemptions (promo_code_id, user_id, order_id) values (:c, :u, :o)")
                    .param("c", quote.promoCodeId()).param("u", user).param("o", orderId).update();
        }
        // Cash and manual transfer get their payment row now; a Paymob row is created per payment attempt.
        if (cash || "INSTAPAY_MANUAL".equals(req.paymentMethod())) {
            jdbc.sql("""
                    insert into payments (order_id, provider, method, amount, idempotency_key)
                    values (:o, :provider, :method, :amount, :key)
                    """).param("o", orderId).param("provider", cash ? "COD" : "MANUAL_TRANSFER")
                    .param("method", req.paymentMethod()).param("amount", priced.total())
                    .param("key", "order:" + orderId).update();
        }
        history(orderId, null, cash ? "PENDING" : "AWAITING_PAYMENT", user, now);
        cart.clear(user);
        return get(user, reference);
    }

    public OrderView cancel(UUID user, String reference) {
        Head order = lock(user, reference);
        if (!CANCELLABLE.contains(order.status()) || !UNPAID.contains(order.paymentStatus())) {
            throw ApiException.conflict("CANNOT_CANCEL",
                    "This order can no longer be cancelled here. Please contact us.");
        }
        cancelLocked(order, reference, user, true);
        return get(user, reference);
    }

    /**
     * Cancels online-payment orders that were never paid, so their stock goes back on sale.
     * Orders whose transfer is being checked by staff are left alone. Returns how many were cancelled.
     */
    public int expireUnpaid() {
        OffsetDateTime cutoff = now().minusMinutes(settings.unpaidOrderMinutes());
        record Stale(UUID id, String reference, UUID user) {
        }
        List<Stale> stale = jdbc.sql("""
                select id, reference, user_id from orders
                where status = 'AWAITING_PAYMENT' and payment_status in ('PENDING', 'FAILED') and placed_at < :cutoff
                order by placed_at limit 200 for update skip locked
                """).param("cutoff", cutoff)
                .query((rs, n) -> new Stale(rs.getObject(1, UUID.class), rs.getString(2), rs.getObject(3, UUID.class)))
                .list();
        for (Stale order : stale) {
            cancelLocked(new Head(order.id(), "AWAITING_PAYMENT", "PENDING", null, null), order.reference(), null,
                    false);
        }
        return stale.size();
    }

    /** The row must already be locked. {@code actor} is null when the system cancels. */
    void cancelLocked(Head order, String reference, UUID actor, boolean allowUndo) {
        UUID user = actor;
        for (Reserved item : items(order.id())) {
            if (item.variantId() == null) {
                continue;
            }
            jdbc.sql("""
                    update inventory set reserved = reserved - :q, updated_at = now()
                    where variant_id = :v and reserved >= :q
                    """).param("q", item.quantity()).param("v", item.variantId()).update();
            movement(item.variantId(), "RELEASE", item.quantity(), reference, user);
        }
        jdbc.sql("""
                update promo_codes set redeemed_count = redeemed_count - 1
                where redeemed_count > 0 and id in (select promo_code_id from promo_code_redemptions
                                                    where order_id = :o and status = 'RESERVED')
                """).param("o", order.id()).update();
        jdbc.sql("update promo_code_redemptions set status = 'RELEASED' where order_id = :o and status = 'RESERVED'")
                .param("o", order.id()).update();

        OffsetDateTime now = now();
        jdbc.sql("""
                update orders set status = 'CANCELLED', status_before_cancel = :before, cancelled_at = :now,
                       undo_expires_at = :undo, updated_at = :now, version = version + 1
                where id = :id
                """).param("before", allowUndo ? order.status() : null).param("now", now)
                .param("undo", allowUndo ? now.plusMinutes(settings.cancelUndoMinutes()) : null)
                .param("id", order.id()).update();
        history(order.id(), order.status(), "CANCELLED", user, now);
    }

    /** Called by the payments module once money is confirmed (signed webhook or staff check). */
    public void markPaid(UUID orderId, UUID actor) {
        OffsetDateTime now = now();
        int rows = jdbc.sql("""
                update orders set status = 'PAID', payment_status = 'PAID', updated_at = :now, version = version + 1
                where id = :id and status = 'AWAITING_PAYMENT'
                """).param("now", now).param("id", orderId).update();
        if (rows == 1) {
            history(orderId, "AWAITING_PAYMENT", "PAID", actor, now);
        }
    }

    public void setPaymentStatus(UUID orderId, String paymentStatus) {
        jdbc.sql("update orders set payment_status = :s, updated_at = :now, version = version + 1 where id = :id")
                .param("s", paymentStatus).param("now", now()).param("id", orderId).update();
    }

    /** Restores a cancelled order while the undo window is open and the items are still in stock. */
    public OrderView undoCancel(UUID user, String reference) {
        Head order = lock(user, reference);
        OffsetDateTime now = now();
        if (!"CANCELLED".equals(order.status()) || order.statusBeforeCancel() == null
                || order.undoExpiresAt() == null || !order.undoExpiresAt().isAfter(now.toInstant())) {
            throw ApiException.conflict("UNDO_EXPIRED", "This order can no longer be restored.");
        }
        List<Reserved> items = items(order.id()).stream()
                .sorted(Comparator.comparing(Reserved::variantId, Comparator.nullsFirst(Comparator.naturalOrder())))
                .toList();
        for (Reserved item : items) {
            if (item.variantId() == null || !reserve(item.variantId(), item.quantity())) {
                throw ApiException.conflict("OUT_OF_STOCK",
                        "An item in this order has sold out, so it cannot be restored.");
            }
            movement(item.variantId(), "RESERVE", item.quantity(), reference, user);
        }
        Optional<Long> codeId = jdbc.sql("select promo_code_id from promo_code_redemptions"
                + " where order_id = :o and status = 'RELEASED'").param("o", order.id()).query(Long.class).optional();
        if (codeId.isPresent()) {
            int taken = jdbc.sql("""
                    update promo_codes set redeemed_count = redeemed_count + 1
                    where id = :id and (max_redemptions is null or redeemed_count < max_redemptions)
                    """).param("id", codeId.get()).update();
            if (taken == 0) {
                throw ApiException.conflict("PROMO_USED_UP",
                        "The promo code on this order has been used up, so it cannot be restored.");
            }
            jdbc.sql("update promo_code_redemptions set status = 'RESERVED' where order_id = :o")
                    .param("o", order.id()).update();
        }
        jdbc.sql("""
                update orders set status = :status, status_before_cancel = null, cancelled_at = null,
                       undo_expires_at = null, updated_at = :now, version = version + 1
                where id = :id
                """).param("status", order.statusBeforeCancel()).param("now", now).param("id", order.id()).update();
        history(order.id(), "CANCELLED", order.statusBeforeCancel(), user, now);
        return get(user, reference);
    }

    @Transactional(readOnly = true)
    public PageResponse<OrderSummary> list(UUID user, int page, int pageSize) {
        int size = Math.clamp(pageSize, 1, 50);
        int index = Math.max(page, 0);
        long total = jdbc.sql("select count(*) from orders where user_id = :u").param("u", user)
                .query(Long.class).single();
        List<OrderSummary> items = jdbc.sql("""
                select o.reference, o.status, o.total, o.placed_at,
                       (select coalesce(sum(oi.quantity), 0) from order_items oi where oi.order_id = o.id) as item_count
                from orders o where o.user_id = :u order by o.placed_at desc, o.reference desc
                limit :limit offset :offset
                """).param("u", user).param("limit", size).param("offset", (long) index * size)
                .query((rs, n) -> new OrderSummary(rs.getString("reference"), rs.getString("status"),
                        rs.getBigDecimal("total"), rs.getObject("placed_at", OffsetDateTime.class).toInstant(),
                        rs.getInt("item_count")))
                .list();
        return PageResponse.of(items, index, size, total);
    }

    /** Another customer's order looks exactly like one that does not exist. */
    @Transactional(readOnly = true)
    public OrderView get(UUID user, String reference) {
        UUID id = jdbc.sql("select id from orders where reference = :r and user_id = :u")
                .param("r", reference).param("u", user).query(UUID.class).optional()
                .orElseThrow(() -> ApiException.notFound("Order"));
        return view(id);
    }

    /** No ownership check: callers are the customer path above (already scoped) and staff. */
    @Transactional(readOnly = true)
    OrderView view(UUID id) {
        List<ItemView> items = jdbc.sql("""
                select product_name, product_name_ar, color_name, color_name_ar, size_code, image_url, unit_price,
                       quantity, line_total
                from order_items where order_id = :o order by id
                """).param("o", id)
                .query((rs, n) -> new ItemView(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6), rs.getBigDecimal(7), rs.getInt(8), rs.getBigDecimal(9)))
                .list();
        List<HistoryView> history = jdbc.sql("select to_status, created_at from order_status_history"
                + " where order_id = :o order by created_at, id").param("o", id)
                .query((rs, n) -> new HistoryView(rs.getString(1), rs.getObject(2, OffsetDateTime.class).toInstant()))
                .list();
        String transferReference = jdbc.sql("select manual_reference from payments where order_id = :o"
                + " and provider = 'MANUAL_TRANSFER' order by created_at desc limit 1").param("o", id)
                .query((rs, n) -> rs.getString(1)).optional().orElse(null);
        // What the customer needs to follow the parcel; nothing else about the shipment is shown to them.
        String[] shipment = jdbc.sql("select carrier, tracking_reference from shipments where order_id = :o"
                + " order by id desc limit 1").param("o", id)
                .query((rs, n) -> new String[] {rs.getString(1), rs.getString(2)}).optional()
                .orElse(new String[] {null, null});
        Instant now = clock.instant();
        return jdbc.sql("select * from orders where id = :id").param("id", id).query((rs, n) -> {
            String status = rs.getString("status");
            Instant undo = instant(rs.getObject("undo_expires_at", OffsetDateTime.class));
            return new OrderView(rs.getString("reference"), status, rs.getString("payment_status"),
                    rs.getString("payment_method"), rs.getBigDecimal("subtotal"), rs.getBigDecimal("discount_total"),
                    rs.getString("discount_label_en"), rs.getString("discount_label_ar"), rs.getString("promo_code"),
                    rs.getBigDecimal("delivery_fee"), rs.getBigDecimal("total"), rs.getString("customer_name"),
                    rs.getString("customer_phone"), rs.getString("governorate_name"),
                    rs.getString("governorate_name_ar"), rs.getString("city"), rs.getString("address_line"),
                    rs.getString("delivery_notes"), rs.getString("delivery_option_name"),
                    rs.getString("delivery_option_name_ar"), rs.getString("delivery_estimate"),
                    rs.getString("delivery_estimate_ar"),
                    instant(rs.getObject("placed_at", OffsetDateTime.class)),
                    instant(rs.getObject("cancelled_at", OffsetDateTime.class)), undo,
                    CANCELLABLE.contains(status) && UNPAID.contains(rs.getString("payment_status")),
                    "CANCELLED".equals(status) && rs.getString("status_before_cancel") != null && undo != null
                            && undo.isAfter(now),
                    paymentAction(status, rs.getString("payment_status"), rs.getString("payment_method")),
                    transferReference, items, history, shipment[0], shipment[1]);
        }).single();
    }

    /** What the customer still has to do to pay: TRANSFER (send the InstaPay reference), PAYMOB, or nothing. */
    private static String paymentAction(String status, String paymentStatus, String method) {
        if (!"AWAITING_PAYMENT".equals(status) || method == null
                || !("PENDING".equals(paymentStatus) || "FAILED".equals(paymentStatus))) {
            return null;
        }
        if ("INSTAPAY_MANUAL".equals(method)) {
            return "TRANSFER";
        }
        return PaymentMethods.PAYMOB.contains(method) ? "PAYMOB" : null;
    }

    /** True when the stock was reserved. Atomic: the row is only updated while enough is unreserved. */
    private boolean reserve(long variantId, int quantity) {
        return jdbc.sql("""
                update inventory set reserved = reserved + :q, updated_at = now()
                where variant_id = :v and on_hand - reserved >= :q
                """).param("q", quantity).param("v", variantId).update() == 1;
    }

    /** The UPDATE takes the code's row lock first, so the per-customer count below cannot race. */
    private void takePromoCode(long codeId, UUID user) {
        int taken = jdbc.sql("""
                update promo_codes set redeemed_count = redeemed_count + 1
                where id = :id and (max_redemptions is null or redeemed_count < max_redemptions)
                """).param("id", codeId).update();
        if (taken == 0) {
            throw ApiException.conflict("PROMO_USED_UP", "This promo code has been used up.");
        }
        boolean withinLimit = jdbc.sql("""
                select (select count(*) from promo_code_redemptions r
                         where r.promo_code_id = pc.id and r.user_id = :u and r.status <> 'RELEASED') < pc.per_customer_limit
                from promo_codes pc where pc.id = :id
                """).param("u", user).param("id", codeId).query(Boolean.class).single();
        if (!withinLimit) {
            throw ApiException.conflict("PROMO_ALREADY_USED", "You have already used this promo code.");
        }
    }

    private Head lock(UUID user, String reference) {
        return jdbc.sql("select id, status, payment_status, status_before_cancel, undo_expires_at from orders"
                + " where reference = :r and user_id = :u for update").param("r", reference).param("u", user)
                .query((rs, n) -> new Head(rs.getObject("id", UUID.class), rs.getString("status"),
                        rs.getString("payment_status"), rs.getString("status_before_cancel"),
                        instant(rs.getObject("undo_expires_at", OffsetDateTime.class))))
                .optional().orElseThrow(() -> ApiException.notFound("Order"));
    }

    List<Reserved> items(UUID orderId) {
        return jdbc.sql("select variant_id, quantity from order_items where order_id = :o order by variant_id")
                .param("o", orderId)
                .query((rs, n) -> new Reserved((Long) rs.getObject("variant_id"), rs.getInt("quantity"))).list();
    }

    void movement(long variantId, String type, int quantity, String reference, UUID actor) {
        jdbc.sql("""
                insert into inventory_movements (variant_id, type, quantity, reference_type, reference_id, actor_user_id)
                values (:v, :t, :q, 'ORDER', :ref, :a)
                """).param("v", variantId).param("t", type).param("q", quantity).param("ref", reference)
                .param("a", actor).update();
    }

    void history(UUID orderId, String from, String to, UUID actor, OffsetDateTime at) {
        jdbc.sql("""
                insert into order_status_history (order_id, from_status, to_status, actor_user_id, created_at)
                values (:o, :from, :to, :a, :at)
                """).param("o", orderId).param("from", from).param("to", to).param("a", actor).param("at", at)
                .update();
    }

    OffsetDateTime now() {
        return OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
    }

    private static Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }
}
