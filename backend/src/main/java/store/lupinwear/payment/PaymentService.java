package store.lupinwear.payment;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import store.lupinwear.audit.AuditLog;
import store.lupinwear.content.SiteSettings;
import store.lupinwear.order.OrderService;
import store.lupinwear.payment.PaymobGateway.Intention;
import store.lupinwear.payment.PaymobGateway.IntentionRequest;
import store.lupinwear.shared.ApiException;

/**
 * Money. An order becomes PAID in exactly two ways: a Paymob webhook whose HMAC signature and amount
 * check out, or a staff member confirming a manual transfer. A browser redirect never changes anything.
 */
@Service
public class PaymentService {

    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);

    public record PayRedirect(String redirectUrl) {
    }

    public record TransferView(UUID paymentId, String orderReference, String customerName, String customerPhone,
            BigDecimal amount, String transferReference, Instant submittedAt) {
    }

    private record OrderRow(UUID id, String reference, String status, String paymentStatus, String method,
            BigDecimal total, String customerName, String customerPhone, String city, String addressLine) {
    }

    private final JdbcClient jdbc;
    private final TransactionTemplate tx;
    private final PaymobGateway gateway;
    private final PaymobProperties paymob;
    private final PaymentMethods methods;
    private final OrderService orders;
    private final SiteSettings settings;
    private final AuditLog audit;
    private final Clock clock;
    private final String publicBaseUrl;

    public PaymentService(JdbcClient jdbc, TransactionTemplate tx, PaymobGateway gateway, PaymobProperties paymob,
            PaymentMethods methods, OrderService orders, SiteSettings settings, AuditLog audit, Clock clock,
            @Value("${lupin.public-base-url}") String publicBaseUrl) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.gateway = gateway;
        this.paymob = paymob;
        this.methods = methods;
        this.orders = orders;
        this.settings = settings;
        this.audit = audit;
        this.clock = clock;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    // ── Paymob ──

    /**
     * Starts (or restarts) an online payment and returns Paymob's hosted checkout address. Card details
     * are typed on Paymob's page only. Deliberately not one transaction: no database lock is held while
     * we wait for Paymob.
     */
    public PayRedirect startPaymob(UUID user, String reference) {
        OrderRow order = order(user, reference, false);
        Integer integration = paymob.integrationFor(order.method() == null ? "" : order.method());
        if (!"AWAITING_PAYMENT".equals(order.status()) || integration == null || !methods.available(order.method())
                || !List.of("PENDING", "FAILED").contains(order.paymentStatus())) {
            throw ApiException.conflict("PAYMENT_NOT_POSSIBLE", "This order cannot be paid online right now.");
        }
        String email = jdbc.sql("select email from users where id = :u").param("u", user)
                .query((rs, n) -> rs.getString(1)).single();
        UUID paymentId = UUID.randomUUID();
        String[] name = order.customerName().trim().split("\\s+", 2);
        long cents = order.total().movePointRight(2).longValueExact();

        Intention intention = gateway.createIntention(new IntentionRequest(cents, integration,
                "Order " + order.reference(), paymentId.toString(), name[0], name.length > 1 ? name[1] : name[0],
                "+2" + order.customerPhone(), email, order.city(), order.addressLine(),
                publicBaseUrl + "/api/v1/payments/webhooks/paymob",
                publicBaseUrl + "/orders/" + order.reference() + "?payment=return",
                settings.unpaidOrderMinutes() * 60));

        tx.executeWithoutResult(status -> {
            // The order may have changed while we were talking to Paymob.
            OrderRow current = order(user, reference, true);
            if (!"AWAITING_PAYMENT".equals(current.status())) {
                throw ApiException.conflict("PAYMENT_NOT_POSSIBLE", "This order cannot be paid online right now.");
            }
            jdbc.sql("update payments set status = 'CANCELLED', updated_at = now()"
                    + " where order_id = :o and provider = 'PAYMOB' and status = 'PENDING'")
                    .param("o", current.id()).update();
            jdbc.sql("""
                    insert into payments (id, order_id, provider, method, amount, idempotency_key, provider_order_id)
                    values (:id, :o, 'PAYMOB', :method, :amount, :key, :providerOrder)
                    """).param("id", paymentId).param("o", current.id()).param("method", current.method())
                    .param("amount", current.total()).param("key", paymentId.toString())
                    .param("providerOrder", intention.providerOrderId()).update();
            if ("FAILED".equals(current.paymentStatus())) {
                orders.setPaymentStatus(current.id(), "PENDING");
            }
        });
        return new PayRedirect(paymob.checkoutUrl() + "?publicKey=" + encode(paymob.publicKey()) + "&clientSecret="
                + encode(intention.clientSecret()));
    }

    /** True when the signature is valid (the caller answers 200). False → 401, and nothing is stored. */
    public boolean handlePaymobWebhook(JsonNode body, String hmac) {
        JsonNode txn = body.path("obj");
        if (!paymob.configured() || hmac == null || !signatureValid(txn, hmac)) {
            log.warn("Rejected Paymob webhook: bad or missing signature");
            return false;
        }
        if (!"TRANSACTION".equals(body.path("type").asText())) {
            return true;
        }
        tx.executeWithoutResult(status -> process(body, txn));
        return true;
    }

    private void process(JsonNode body, JsonNode txn) {
        String eventKey = "txn:" + txn.path("id").asText() + ":" + txn.path("success").asText() + ":"
                + txn.path("pending").asText() + ":" + txn.path("is_refunded").asText() + ":"
                + txn.path("is_voided").asText();
        // Paymob retries; the unique key makes a repeated delivery a no-op.
        Optional<Long> eventId = jdbc.sql("""
                insert into payment_events (provider, event_key, event_type, signature_valid, payload)
                values ('PAYMOB', :key, 'TRANSACTION', true, cast(:payload as jsonb))
                on conflict (provider, event_key) do nothing returning id
                """).param("key", eventKey).param("payload", body.toString()).query(Long.class).optional();
        if (eventId.isEmpty()) {
            return;
        }

        record Row(UUID id, UUID orderId, BigDecimal amount, String status) {
        }
        Optional<Row> found = jdbc.sql("select id, order_id, amount, status from payments"
                + " where provider = 'PAYMOB' and provider_order_id = :po for update")
                .param("po", txn.path("order").path("id").asText())
                .query((rs, n) -> new Row(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class),
                        rs.getBigDecimal(3), rs.getString(4)))
                .optional();
        if (found.isEmpty()) {
            finish(eventId.get(), null, "UNKNOWN_ORDER");
            return;
        }
        Row payment = found.get();
        boolean success = txn.path("success").asBoolean(false);
        boolean pending = txn.path("pending").asBoolean(false);
        if (pending) {
            finish(eventId.get(), payment.id(), null);
            return;
        }
        if (!success) {
            if ("PENDING".equals(payment.status())) {
                jdbc.sql("update payments set status = 'FAILED', provider_transaction_id = :t, updated_at = now()"
                        + " where id = :id").param("t", txn.path("id").asText()).param("id", payment.id()).update();
                String orderStatus = orderStatus(payment.orderId());
                if ("AWAITING_PAYMENT".equals(orderStatus)) {
                    orders.setPaymentStatus(payment.orderId(), "FAILED");
                }
            }
            finish(eventId.get(), payment.id(), null);
            return;
        }
        // A successful capture: it only counts if it is exactly our amount in EGP and not reversed.
        long expectedCents = payment.amount().movePointRight(2).longValueExact();
        if (txn.path("amount_cents").asLong(-1) != expectedCents || !"EGP".equals(txn.path("currency").asText())) {
            finish(eventId.get(), payment.id(), "AMOUNT_MISMATCH");
            return;
        }
        if (txn.path("is_voided").asBoolean() || txn.path("is_refunded").asBoolean()
                || txn.path("is_auth").asBoolean()) {
            finish(eventId.get(), payment.id(), "NOT_A_CAPTURE");
            return;
        }
        if ("PAID".equals(payment.status())) {
            finish(eventId.get(), payment.id(), null);
            return;
        }
        jdbc.sql("update payments set status = 'PAID', provider_transaction_id = :t, updated_at = now() where id = :id")
                .param("t", txn.path("id").asText()).param("id", payment.id()).update();
        String orderStatus = orderStatus(payment.orderId());
        if ("AWAITING_PAYMENT".equals(orderStatus)) {
            orders.markPaid(payment.orderId(), null);
            finish(eventId.get(), payment.id(), null);
        } else {
            // Money arrived for an order that is cancelled or already paid: it must be given back by a person.
            orders.setPaymentStatus(payment.orderId(), "REFUND_PENDING");
            audit.record(null, "PAYMENT_NEEDS_REFUND", "payment", payment.id(), Map.of("orderStatus", orderStatus));
            finish(eventId.get(), payment.id(), "ORDER_" + orderStatus + "_NEEDS_REFUND");
        }
    }

    /**
     * Paymob's documented rule for the "transaction processed" callback: HMAC-SHA512, keyed with the
     * HMAC secret, over these 20 values joined in this order, hex encoded, sent as the hmac query parameter.
     */
    boolean signatureValid(JsonNode txn, String hmac) {
        String data = String.join("", text(txn, "amount_cents"), text(txn, "created_at"), text(txn, "currency"),
                text(txn, "error_occured"), text(txn, "has_parent_transaction"), text(txn, "id"),
                text(txn, "integration_id"), text(txn, "is_3d_secure"), text(txn, "is_auth"),
                text(txn, "is_capture"), text(txn, "is_refunded"), text(txn, "is_standalone_payment"),
                text(txn, "is_voided"), text(txn.path("order"), "id"), text(txn, "owner"), text(txn, "pending"),
                text(txn.path("source_data"), "pan"), text(txn.path("source_data"), "sub_type"),
                text(txn.path("source_data"), "type"), text(txn, "success"));
        return MessageDigest.isEqual(sign(data, paymob.hmacSecret()).getBytes(StandardCharsets.UTF_8),
                hmac.trim().toLowerCase().getBytes(StandardCharsets.UTF_8));
    }

    public static String sign(String data, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA512");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA512"));
            return HexFormat.of().formatHex(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String text(JsonNode node, String field) {
        return node.path(field).asText("");
    }

    // ── Manual InstaPay transfer ──

    /** The customer tells us the reference of the transfer they made. Staff then check the bank app. */
    public void submitTransfer(UUID user, String reference, String transferReference) {
        tx.executeWithoutResult(status -> {
            OrderRow order = order(user, reference, true);
            int rows = !"AWAITING_PAYMENT".equals(order.status()) ? 0 : jdbc.sql("""
                    update payments set status = 'VERIFYING', manual_reference = :ref, updated_at = now()
                    where order_id = :o and provider = 'MANUAL_TRANSFER' and status in ('PENDING', 'FAILED')
                    """).param("ref", transferReference.trim()).param("o", order.id()).update();
            if (rows == 0) {
                throw ApiException.conflict("PAYMENT_NOT_POSSIBLE", "A transfer cannot be recorded for this order.");
            }
            orders.setPaymentStatus(order.id(), "VERIFYING");
        });
    }

    public List<TransferView> transfersToVerify() {
        return jdbc.sql("""
                select p.id, o.reference, o.customer_name, o.customer_phone, p.amount, p.manual_reference, p.updated_at
                from payments p join orders o on o.id = p.order_id
                where p.provider = 'MANUAL_TRANSFER' and p.status = 'VERIFYING' order by p.updated_at limit 200
                """).query((rs, n) -> new TransferView(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getBigDecimal(5), rs.getString(6),
                        rs.getObject(7, OffsetDateTime.class).toInstant()))
                .list();
    }

    /** Staff decision on a transfer, after checking that the money really arrived. */
    public void decideTransfer(UUID actor, UUID paymentId, boolean received, String note) {
        tx.executeWithoutResult(status -> {
            UUID orderId = jdbc.sql("select order_id from payments where id = :id and provider = 'MANUAL_TRANSFER'"
                    + " and status = 'VERIFYING' for update").param("id", paymentId).query(UUID.class).optional()
                    .orElseThrow(() -> ApiException.conflict("NOT_WAITING", "This transfer is not waiting for a check."));
            String orderStatus = jdbc.sql("select status from orders where id = :id for update").param("id", orderId)
                    .query(String.class).single();
            if (received && !"AWAITING_PAYMENT".equals(orderStatus)) {
                throw ApiException.conflict("ORDER_NOT_AWAITING_PAYMENT",
                        "This order is " + orderStatus + ". Reject the transfer and refund the customer.");
            }
            jdbc.sql("""
                    update payments set status = :s, verified_by = :by, verified_at = :at, updated_at = now()
                    where id = :id
                    """).param("s", received ? "PAID" : "FAILED").param("by", actor)
                    .param("at", OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC)).param("id", paymentId)
                    .update();
            if (received) {
                orders.markPaid(orderId, actor);
            } else if ("AWAITING_PAYMENT".equals(orderStatus)) {
                orders.setPaymentStatus(orderId, "FAILED");
            }
            audit.record(actor, received ? "TRANSFER_CONFIRMED" : "TRANSFER_REJECTED", "payment", paymentId,
                    Map.of("note", note == null ? "" : note));
        });
    }

    // ── helpers ──

    private OrderRow order(UUID user, String reference, boolean lock) {
        return jdbc.sql("select id, reference, status, payment_status, payment_method, total, customer_name,"
                + " customer_phone, city, address_line from orders where reference = :r and user_id = :u"
                + (lock ? " for update" : "")).param("r", reference).param("u", user)
                .query((rs, n) -> new OrderRow(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getString(5), rs.getBigDecimal(6), rs.getString(7), rs.getString(8),
                        rs.getString(9), rs.getString(10)))
                .optional().orElseThrow(() -> ApiException.notFound("Order"));
    }

    private String orderStatus(UUID orderId) {
        return jdbc.sql("select status from orders where id = :id for update").param("id", orderId)
                .query(String.class).single();
    }

    private void finish(long eventId, UUID paymentId, String error) {
        jdbc.sql("update payment_events set processed_at = now(), payment_id = :p, error = :e where id = :id")
                .param("p", paymentId).param("e", error).param("id", eventId).update();
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
