package store.lupinwear.order;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import store.lupinwear.audit.AuditLog;
import store.lupinwear.order.OrderService.Head;
import store.lupinwear.order.OrderService.OrderView;
import store.lupinwear.order.OrderService.Reserved;
import store.lupinwear.shared.ApiException;
import store.lupinwear.shared.PageResponse;

/**
 * What staff do with orders. Every status change goes through {@link #TRANSITIONS}; anything else is refused.
 *
 *   cash:    PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED (cash collected on delivery)
 *   online:  AWAITING_PAYMENT → PAID (payments module only) → [CONFIRMED →] PROCESSING → SHIPPED → DELIVERED
 *   cancel:  any state before SHIPPED
 *
 * Stock leaves the warehouse count when an order ships; until then it is only reserved.
 */
@Service
@Transactional
public class OrderAdminService {

    static final Map<String, Set<String>> TRANSITIONS = Map.of(
            "PENDING", Set.of("CONFIRMED", "CANCELLED"),
            "AWAITING_PAYMENT", Set.of("CANCELLED"),
            "PAID", Set.of("CONFIRMED", "PROCESSING", "CANCELLED"),
            "CONFIRMED", Set.of("PROCESSING", "CANCELLED"),
            "PROCESSING", Set.of("SHIPPED", "CANCELLED"),
            "SHIPPED", Set.of("DELIVERED"));

    private static final List<String> STATUS_ORDER = List.of("CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED",
            "CANCELLED");

    public record OrderRow(String reference, String status, String paymentStatus, String paymentMethod,
            BigDecimal total, String customerName, String customerPhone, String governorate, Instant placedAt,
            int itemCount) {
    }

    public record PaymentRow(UUID id, String provider, String method, String status, BigDecimal amount,
            String transferReference, String providerTransactionId, Instant createdAt) {
    }

    public record ShipmentRow(String carrier, String trackingReference, String status, Instant shippedAt,
            Instant deliveredAt, Integer courierState, String courierStateLabel, String lastException,
            BigDecimal codAmount) {
    }

    public record HistoryRow(String fromStatus, String toStatus, String actor, String note, Instant at) {
    }

    public record AdminOrderView(OrderView order, String customerEmail, List<String> nextStatuses,
            List<PaymentRow> payments, ShipmentRow shipment, List<HistoryRow> history) {
    }

    public record Summary(Map<String, Long> ordersByStatus, long transfersToCheck, long refundsPending,
            long lowStockVariants, long shipmentsNeedingAttention) {
    }

    /** Courier states that need a person: returned, exception, cancelled, terminated, lost, damaged, awaiting action. */
    static final List<Integer> COURIER_PROBLEM_STATES = List.of(46, 47, 48, 49, 100, 101, 103);

    public record StatusChange(String status, String note, String carrier, String trackingReference) {
    }

    private final JdbcClient jdbc;
    private final OrderService orders;
    private final AuditLog audit;

    public OrderAdminService(JdbcClient jdbc, OrderService orders, AuditLog audit) {
        this.jdbc = jdbc;
        this.orders = orders;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public PageResponse<OrderRow> list(String status, String query, int page, int pageSize) {
        int size = Math.clamp(pageSize, 1, 100);
        int index = Math.max(page, 0);
        Map<String, Object> params = new HashMap<>();
        StringBuilder where = new StringBuilder(" from orders o where true");
        if (status != null && !status.isBlank()) {
            where.append(" and o.status = :status");
            params.put("status", status);
        }
        if (query != null && !query.isBlank()) {
            // Reference, phone or name. Wildcards typed by staff are matched literally.
            where.append(" and (o.reference ilike :q escape '\\' or o.customer_phone like :q escape '\\'"
                    + " or o.customer_name ilike :q escape '\\')");
            params.put("q", "%" + query.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
        }
        long total = jdbc.sql("select count(*)" + where).params(params).query(Long.class).single();
        params.put("limit", size);
        params.put("offset", (long) index * size);
        List<OrderRow> rows = jdbc.sql("select o.reference, o.status, o.payment_status, o.payment_method, o.total,"
                + " o.customer_name, o.customer_phone, o.governorate_name, o.placed_at,"
                + " (select coalesce(sum(oi.quantity), 0) from order_items oi where oi.order_id = o.id) as item_count"
                + where + " order by o.placed_at desc, o.reference desc limit :limit offset :offset")
                .params(params)
                .query((rs, n) -> new OrderRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getBigDecimal(5), rs.getString(6), rs.getString(7), rs.getString(8),
                        rs.getObject(9, OffsetDateTime.class).toInstant(), rs.getInt(10)))
                .list();
        return PageResponse.of(rows, index, size, total);
    }

    @Transactional(readOnly = true)
    public AdminOrderView get(String reference) {
        record Ids(UUID id, UUID user, String status) {
        }
        Ids ids = jdbc.sql("select id, user_id, status from orders where reference = :r").param("r", reference)
                .query((rs, n) -> new Ids(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getString(3)))
                .optional().orElseThrow(() -> ApiException.notFound("Order"));
        String email = jdbc.sql("select email from users where id = :u").param("u", ids.user())
                .query((rs, n) -> rs.getString(1)).single();
        List<PaymentRow> payments = jdbc.sql("""
                select id, provider, method, status, amount, manual_reference, provider_transaction_id, created_at
                from payments where order_id = :o order by created_at
                """).param("o", ids.id())
                .query((rs, n) -> new PaymentRow(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getBigDecimal(5), rs.getString(6), rs.getString(7),
                        rs.getObject(8, OffsetDateTime.class).toInstant()))
                .list();
        ShipmentRow shipment = jdbc.sql("select carrier, tracking_reference, status, shipped_at, delivered_at,"
                + " provider_state, provider_state_label, last_exception, cod_amount"
                + " from shipments where order_id = :o order by id desc limit 1").param("o", ids.id())
                .query((rs, n) -> new ShipmentRow(rs.getString(1), rs.getString(2), rs.getString(3),
                        instant(rs.getObject(4, OffsetDateTime.class)), instant(rs.getObject(5, OffsetDateTime.class)),
                        rs.getObject(6) == null ? null : ((Number) rs.getObject(6)).intValue(),
                        rs.getString(7), rs.getString(8), rs.getBigDecimal(9)))
                .optional().orElse(null);
        List<HistoryRow> history = jdbc.sql("""
                select h.from_status, h.to_status, u.full_name, h.note, h.created_at
                from order_status_history h left join users u on u.id = h.actor_user_id
                where h.order_id = :o order by h.created_at, h.id
                """).param("o", ids.id())
                .query((rs, n) -> new HistoryRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getObject(5, OffsetDateTime.class).toInstant()))
                .list();
        List<String> next = STATUS_ORDER.stream()
                .filter(TRANSITIONS.getOrDefault(ids.status(), Set.of())::contains).toList();
        return new AdminOrderView(orders.view(ids.id()), email, next, payments, shipment, history);
    }

    public AdminOrderView changeStatus(UUID actor, String reference, StatusChange change) {
        Head order = jdbc.sql("select id, status, payment_status from orders where reference = :r for update")
                .param("r", reference)
                .query((rs, n) -> new Head(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), null, null))
                .optional().orElseThrow(() -> ApiException.notFound("Order"));
        String to = change.status();
        if (!TRANSITIONS.getOrDefault(order.status(), Set.of()).contains(to)) {
            throw ApiException.conflict("INVALID_TRANSITION",
                    "An order that is " + order.status() + " cannot become " + to + ".");
        }
        OffsetDateTime now = orders.now();
        String note = change.note() == null || change.note().isBlank() ? null : change.note().trim();

        if ("CANCELLED".equals(to)) {
            // Releases stock and the promo code, and writes the history row. No customer undo for a staff cancel.
            orders.cancelLocked(order, reference, actor, false);
            if (note != null) {
                jdbc.sql("update order_status_history set note = :n where id = (select max(id) from"
                        + " order_status_history where order_id = :o)").param("n", note).param("o", order.id()).update();
            }
            if ("PAID".equals(order.paymentStatus())) {
                orders.setPaymentStatus(order.id(), "REFUND_PENDING");
            }
        } else {
            if ("SHIPPED".equals(to)) {
                ship(order.id(), reference, actor, change, now);
            }
            if ("DELIVERED".equals(to)) {
                deliver(order.id(), actor, now);
            }
            jdbc.sql("update orders set status = :s, updated_at = :now, version = version + 1 where id = :id")
                    .param("s", to).param("now", now).param("id", order.id()).update();
            jdbc.sql("""
                    insert into order_status_history (order_id, from_status, to_status, actor_user_id, note, created_at)
                    values (:o, :from, :to, :a, :n, :at)
                    """).param("o", order.id()).param("from", order.status()).param("to", to).param("a", actor)
                    .param("n", note).param("at", now).update();
        }
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("from", order.status());
        detail.put("to", to);
        if (note != null) {
            detail.put("note", note);
        }
        audit.record(actor, "ORDER_STATUS", "order", reference, detail);
        return get(reference);
    }

    /**
     * Records that money owed back to the customer has actually been returned (by hand, outside this
     * system). Only possible while the order is waiting for a refund.
     */
    public AdminOrderView markRefunded(UUID actor, String reference, String note) {
        record Row(UUID id, String paymentStatus) {
        }
        Row order = jdbc.sql("select id, payment_status from orders where reference = :r for update")
                .param("r", reference).query((rs, n) -> new Row(rs.getObject(1, UUID.class), rs.getString(2)))
                .optional().orElseThrow(() -> ApiException.notFound("Order"));
        if (!"REFUND_PENDING".equals(order.paymentStatus())) {
            throw ApiException.conflict("NO_REFUND_DUE", "This order is not waiting for a refund.");
        }
        String reason = note == null || note.isBlank() ? null : note.trim();
        jdbc.sql("""
                insert into refunds (payment_id, amount, status, reason, created_by)
                select p.id, p.amount, 'SUCCEEDED', :reason, :by from payments p
                where p.order_id = :o and p.status = 'PAID'
                """).param("reason", reason).param("by", actor).param("o", order.id()).update();
        jdbc.sql("update payments set status = 'REFUNDED', updated_at = now() where order_id = :o and status = 'PAID'")
                .param("o", order.id()).update();
        orders.setPaymentStatus(order.id(), "REFUNDED");
        audit.record(actor, "ORDER_REFUNDED", "order", reference, reason == null ? Map.of() : Map.of("note", reason));
        return get(reference);
    }

    /** The goods leave: reserved stock becomes stock that is gone. */
    private void ship(UUID orderId, String reference, UUID actor, StatusChange change, OffsetDateTime now) {
        for (Reserved item : orders.items(orderId)) {
            if (item.variantId() == null) {
                continue;
            }
            int rows = jdbc.sql("""
                    update inventory set on_hand = on_hand - :q, reserved = reserved - :q, updated_at = now()
                    where variant_id = :v and reserved >= :q and on_hand >= :q
                    """).param("q", item.quantity()).param("v", item.variantId()).update();
            if (rows == 0) {
                throw ApiException.conflict("STOCK_INCONSISTENT",
                        "The stock count for an item in this order does not cover it. Check the stock first.");
            }
            orders.movement(item.variantId(), "SHIP", -item.quantity(), reference, actor);
        }
        jdbc.sql("""
                insert into shipments (order_id, carrier, tracking_reference, status, shipped_at)
                values (:o, :carrier, :tracking, 'SHIPPED', :now)
                """).param("o", orderId).param("carrier", blankToNull(change.carrier()))
                .param("tracking", blankToNull(change.trackingReference())).param("now", now).update();
    }

    private void deliver(UUID orderId, UUID actor, OffsetDateTime now) {
        jdbc.sql("update shipments set status = 'DELIVERED', delivered_at = :now where order_id = :o"
                + " and status = 'SHIPPED'").param("now", now).param("o", orderId).update();
        // Cash on delivery: handing the parcel over is when the money is collected.
        jdbc.sql("""
                update payments set status = 'PAID', verified_by = :by, verified_at = :now, updated_at = now()
                where order_id = :o and provider = 'COD' and status = 'PENDING'
                """).param("by", actor).param("now", now).param("o", orderId).update();
        // Decided by the order's own method, so it also holds for an order that has no payment row.
        boolean cash = jdbc.sql("select payment_method = 'COD' and payment_status <> 'PAID' from orders where id = :o")
                .param("o", orderId).query(Boolean.class).single();
        if (cash) {
            orders.setPaymentStatus(orderId, "PAID");
        }
        jdbc.sql("update promo_code_redemptions set status = 'CONFIRMED' where order_id = :o and status = 'RESERVED'")
                .param("o", orderId).update();
    }

    @Transactional(readOnly = true)
    public Summary summary() {
        Map<String, Long> byStatus = new LinkedHashMap<>();
        for (String s : List.of("PENDING", "AWAITING_PAYMENT", "PAID", "CONFIRMED", "PROCESSING", "SHIPPED")) {
            byStatus.put(s, 0L);
        }
        jdbc.sql("select status, count(*) from orders where status in (:s) group by status")
                .param("s", List.copyOf(byStatus.keySet()))
                .query((rs, n) -> byStatus.put(rs.getString(1), rs.getLong(2))).list();
        long transfers = jdbc.sql("select count(*) from payments where provider = 'MANUAL_TRANSFER'"
                + " and status = 'VERIFYING'").query(Long.class).single();
        long refunds = jdbc.sql("select count(*) from orders where payment_status = 'REFUND_PENDING'")
                .query(Long.class).single();
        long lowStock = jdbc.sql("""
                select count(*) from inventory i join product_variants v on v.id = i.variant_id
                join products p on p.id = v.product_id
                where v.active and p.status = 'ACTIVE' and p.deleted_at is null and i.on_hand - i.reserved <= 2
                """).query(Long.class).single();
        long shipmentProblems = jdbc.sql("""
                select count(*) from shipments s join orders o on o.id = s.order_id
                where o.status = 'SHIPPED' and s.provider_state in (:states)
                """).param("states", COURIER_PROBLEM_STATES).query(Long.class).single();
        return new Summary(byStatus, transfers, refunds, lowStock, shipmentProblems);
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }
}
