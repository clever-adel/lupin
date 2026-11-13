package store.lupinwear.shipping;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import store.lupinwear.audit.AuditLog;
import store.lupinwear.order.OrderAdminService;
import store.lupinwear.order.OrderAdminService.AdminOrderView;
import store.lupinwear.order.OrderAdminService.StatusChange;
import store.lupinwear.shared.ApiException;
import store.lupinwear.shipping.BostaGateway.Created;
import store.lupinwear.shipping.BostaGateway.District;
import store.lupinwear.shipping.BostaGateway.NewDelivery;

/**
 * Sending orders with Bosta and following them afterwards.
 *
 * Staff pick the district (Bosta needs one; our checkout only asks for a free-text city), we create the
 * delivery at Bosta, and the order becomes SHIPPED with Bosta's tracking number. Bosta then reports each
 * status change to our webhook; "Delivered" completes the order (and collects cash on delivery),
 * returns and problems are flagged on the dashboard for a person to handle.
 */
@Service
public class ShippingService {

    public static final String CARRIER = "Bosta";
    static final String PROVIDER = "BOSTA";

    /** Bosta's limit for cash on delivery per parcel (EGP), from its create-delivery documentation. */
    static final BigDecimal MAX_COD = new BigDecimal("30000");

    static final int DELIVERED = 45;
    static final int RETURNED = 46;
    static final int EXCEPTION = 47;

    /** Bosta's delivery states (docs.bosta.co, "Delivery states"). Unknown codes are shown by number. */
    static final Map<Integer, String> STATE_LABELS = Map.ofEntries(
            Map.entry(10, "Pickup requested"),
            Map.entry(11, "Waiting for route"),
            Map.entry(20, "Route assigned"),
            Map.entry(21, "Picked up from you"),
            Map.entry(24, "Received at Bosta warehouse"),
            Map.entry(30, "In transit between hubs"),
            Map.entry(41, "Out for delivery"),
            Map.entry(45, "Delivered"),
            Map.entry(46, "Returned to you"),
            Map.entry(47, "Delivery problem"),
            Map.entry(48, "Terminated"),
            Map.entry(49, "Cancelled"),
            Map.entry(100, "Lost"),
            Map.entry(101, "Damaged"),
            Map.entry(102, "Under investigation"),
            Map.entry(103, "Waiting for your action"),
            Map.entry(104, "Archived"),
            Map.entry(105, "On hold"));

    static final Set<Integer> PROBLEM_STATES = Set.of(48, 49, 100, 101, 103);

    public record BostaInfo(boolean configured, String governorate, String cityName, boolean deliverable,
            String customerCity, List<District> districts, String suggestedDistrictId, BigDecimal codAmount,
            boolean canSend, String reason) {
    }

    public record SendRequest(String districtId, String notes) {
    }

    private static final Logger log = LoggerFactory.getLogger(ShippingService.class);

    private final JdbcClient jdbc;
    private final TransactionTemplate tx;
    private final BostaGateway bosta;
    private final BostaProperties props;
    private final OrderAdminService orders;
    private final AuditLog audit;
    private final String publicBaseUrl;
    /** One send per order at a time, so a double click cannot create two Bosta deliveries. */
    private final Set<String> sending = ConcurrentHashMap.newKeySet();

    public ShippingService(JdbcClient jdbc, TransactionTemplate tx, BostaGateway bosta, BostaProperties props,
            OrderAdminService orders, AuditLog audit, @Value("${lupin.public-base-url}") String publicBaseUrl) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.bosta = bosta;
        this.props = props;
        this.orders = orders;
        this.audit = audit;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    private record OrderRow(UUID id, String status, String paymentMethod, String paymentStatus, BigDecimal total,
            String governorateCode, String customerName, String phone, String city, String addressLine,
            String deliveryNotes, String email) {
    }

    private OrderRow load(String reference) {
        return jdbc.sql("""
                select o.id, o.status, o.payment_method, o.payment_status, o.total, g.code, o.customer_name,
                       o.customer_phone, o.city, o.address_line, o.delivery_notes, u.email
                from orders o join governorates g on g.id = o.governorate_id join users u on u.id = o.user_id
                where o.reference = :r
                """).param("r", reference)
                .query((rs, n) -> new OrderRow(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getBigDecimal(5), rs.getString(6), rs.getString(7), rs.getString(8),
                        rs.getString(9), rs.getString(10), rs.getString(11), rs.getString(12)))
                .optional().orElseThrow(() -> ApiException.notFound("Order"));
    }

    /** What the dashboard needs to offer "Send with Bosta" for one order. */
    public BostaInfo info(String reference) {
        OrderRow o = load(reference);
        var city = BostaCities.forGovernorate(o.governorateCode());
        BigDecimal cod = codAmount(o);
        String reason = refusal(o, city.isPresent() && city.get().dropOff());
        if (!props.configured()) {
            return new BostaInfo(false, o.governorateCode(), city.map(BostaCities.City::name).orElse(null),
                    city.map(BostaCities.City::dropOff).orElse(false), o.city(), List.of(), null, cod, false,
                    "Bosta is not set up on the server.");
        }
        if (city.isEmpty() || !city.get().dropOff()) {
            return new BostaInfo(true, o.governorateCode(), city.map(BostaCities.City::name).orElse(null), false,
                    o.city(), List.of(), null, cod, false, reason);
        }
        List<District> districts = bosta.districts(city.get().id()).stream().filter(District::dropOff).toList();
        return new BostaInfo(true, o.governorateCode(), city.get().name(), true, o.city(), districts,
                suggestDistrict(o.city(), districts), cod, reason == null, reason);
    }

    private String refusal(OrderRow o, boolean deliverable) {
        if (alreadySent(o.id())) {
            return "This order has already been sent with Bosta.";
        }
        if (!"PROCESSING".equals(o.status())) {
            return "Only orders that are being prepared (PROCESSING) can be sent.";
        }
        if (!deliverable) {
            return "Bosta does not deliver to this governorate.";
        }
        if (codAmount(o).compareTo(MAX_COD) > 0) {
            return "Bosta collects at most " + MAX_COD.toPlainString() + " EGP cash on delivery per parcel.";
        }
        return null;
    }

    private boolean alreadySent(UUID orderId) {
        return jdbc.sql("select count(*) from shipments where order_id = :o and carrier = :c")
                .param("o", orderId).param("c", CARRIER).query(Long.class).single() > 0;
    }

    /** Cash on delivery is the order total, unless it has already been paid (online, transfer). */
    static BigDecimal codAmount(String paymentMethod, String paymentStatus, BigDecimal total) {
        return "COD".equals(paymentMethod) && !"PAID".equals(paymentStatus) ? total : BigDecimal.ZERO;
    }

    private static BigDecimal codAmount(OrderRow o) {
        return codAmount(o.paymentMethod(), o.paymentStatus(), o.total());
    }

    /** The customer typed their city/area freely; pick the Bosta district whose name matches it, if any. */
    static String suggestDistrict(String typed, List<District> districts) {
        // Compared without spaces: "Arab El Maadi" and Bosta's "Arab ElMaadi" are the same place.
        String want = compact(typed);
        if (want.isEmpty()) {
            return null;
        }
        for (District d : districts) {
            if (want.equals(compact(d.name())) || want.equals(compact(d.nameAr()))) {
                return d.districtId();
            }
        }
        // Otherwise the closest partial match: "Maadi" should pick "ElMaadi", not "Maadi Gardens Compound".
        String best = null;
        int bestGap = Integer.MAX_VALUE;
        for (District d : districts) {
            for (String name : List.of(compact(d.name()), compact(d.nameAr()))) {
                if (name.length() >= 3 && (want.contains(name) || name.contains(want))) {
                    int gap = Math.abs(name.length() - want.length());
                    if (gap < bestGap) {
                        bestGap = gap;
                        best = d.districtId();
                    }
                }
            }
        }
        return best;
    }

    private static String compact(String s) {
        return normalize(s).replace(" ", "");
    }

    static String normalize(String s) {
        if (s == null) {
            return "";
        }
        String n = Normalizer.normalize(s, Normalizer.Form.NFKD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT)
                .replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا').replace('ة', 'ه').replace('ى', 'ي')
                .replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
        // Bosta writes "ElMaadi", customers write "Maadi", "El Maadi" or "المعادي": drop the article.
        if (n.length() > 4 && (n.startsWith("el") || n.startsWith("al") || n.startsWith("ال"))) {
            n = n.substring(2).trim();
        }
        return n;
    }

    /** Creates the Bosta delivery, then marks the order SHIPPED with Bosta's tracking number. */
    public AdminOrderView send(UUID actor, String reference, SendRequest request) {
        if (!props.configured()) {
            throw new ApiException(HttpStatus.CONFLICT, "BOSTA_NOT_CONFIGURED", "Bosta is not set up on the server.");
        }
        if (!sending.add(reference)) {
            throw ApiException.conflict("BOSTA_IN_PROGRESS", "This order is already being sent. Wait a moment.");
        }
        try {
            OrderRow o = load(reference);
            var city = BostaCities.forGovernorate(o.governorateCode());
            String reason = refusal(o, city.isPresent() && city.get().dropOff());
            if (reason != null) {
                throw ApiException.conflict("BOSTA_NOT_ALLOWED", reason);
            }
            String districtId = request.districtId() == null ? "" : request.districtId().trim();
            District district = bosta.districts(city.get().id()).stream()
                    .filter(d -> d.dropOff() && d.districtId().equals(districtId)).findFirst()
                    .orElseThrow(() -> ApiException.badRequest("BOSTA_DISTRICT",
                            "Choose the customer's district from Bosta's list."));

            BigDecimal cod = codAmount(o);
            String[] names = splitName(o.customerName());
            Items items = items(o.id());
            String notes = joinNotes(o.deliveryNotes(), request.notes());
            Created created = bosta.createDelivery(new NewDelivery(reference, cod, city.get().name(),
                    district.districtId(), o.addressLine(), o.city(), names[0], names[1], o.phone(), o.email(),
                    items.description(), items.count(), props.packageType(), notes,
                    blankToNull(props.businessLocationId()), publicBaseUrl + "/api/v1/shipping/webhooks/bosta",
                    props.webhookHeader(), props.webhookSecret().trim()));
            try {
                return tx.execute(s -> {
                    String note = "Sent with Bosta (" + district.name() + ")";
                    orders.changeStatus(actor, reference, new StatusChange("SHIPPED", note, CARRIER,
                            created.trackingNumber()));
                    jdbc.sql("""
                            update shipments set provider_delivery_id = :d, provider_state = 10,
                                   provider_state_label = :label, provider_state_at = now(), cod_amount = :cod,
                                   updated_at = now()
                            where id = (select max(id) from shipments where order_id = :o)
                            """).param("d", created.deliveryId()).param("label", STATE_LABELS.get(10))
                            .param("cod", cod).param("o", o.id()).update();
                    Map<String, Object> detail = new LinkedHashMap<>();
                    detail.put("trackingNumber", created.trackingNumber());
                    detail.put("district", district.name());
                    detail.put("cod", cod);
                    audit.record(actor, "BOSTA_DELIVERY_CREATED", "order", reference, detail);
                    return orders.get(reference);
                });
            } catch (RuntimeException e) {
                // Bosta has the delivery but we could not record it. Say so loudly: staff must cancel it there.
                log.error("Bosta delivery {} (tracking {}) was created for order {} but saving it failed",
                        created.deliveryId(), created.trackingNumber(), reference, e);
                throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "BOSTA_NOT_RECORDED",
                        "Bosta created delivery " + created.trackingNumber() + " but the order could not be updated: "
                                + (e instanceof ApiException a ? a.getMessage() : "unexpected error")
                                + ". Cancel that delivery in the Bosta dashboard before trying again.");
            }
        } finally {
            sending.remove(reference);
        }
    }

    record Items(String description, int count) {
    }

    private Items items(UUID orderId) {
        List<String> parts = new ArrayList<>();
        int[] count = {0};
        jdbc.sql("select product_name, color_name, size_code, quantity from order_items where order_id = :o order by id")
                .param("o", orderId).query(rs -> {
                    parts.add(rs.getInt(4) + "x " + rs.getString(1) + " " + rs.getString(2) + " " + rs.getString(3));
                    count[0] += rs.getInt(4);
                });
        String description = String.join(", ", parts);
        if (description.length() > 200) {
            description = description.substring(0, 197) + "...";
        }
        return new Items(description, count[0]);
    }

    static String[] splitName(String full) {
        String name = full == null ? "" : full.trim().replaceAll("\\s+", " ");
        int space = name.indexOf(' ');
        if (space < 0) {
            // Bosta asks for both; repeating the single name is better than inventing one.
            return new String[] {name, name};
        }
        return new String[] {name.substring(0, space), name.substring(space + 1)};
    }

    private static String joinNotes(String customer, String staff) {
        String a = blankToNull(customer);
        String b = blankToNull(staff);
        String joined = a == null ? b : b == null ? a : a + " | " + b;
        return joined == null ? null : joined.length() > 300 ? joined.substring(0, 300) : joined;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    // ── Bosta → us ──

    /** The shared secret we gave Bosta with each delivery. Constant-time comparison. */
    public boolean authentic(String given) {
        if (!props.configured() || given == null) {
            return false;
        }
        return MessageDigest.isEqual(props.webhookSecret().trim().getBytes(StandardCharsets.UTF_8),
                given.getBytes(StandardCharsets.UTF_8));
    }

    public String webhookHeader() {
        return props.webhookHeader();
    }

    /**
     * One status message from Bosta. Stored once (Bosta retries); applied only if it is not older than
     * what we already know. Returns normally for messages about deliveries we do not know, so Bosta
     * stops retrying them.
     */
    public void handleWebhook(JsonNode body) {
        String deliveryId = body.path("_id").asText("");
        String tracking = body.path("trackingNumber").asText("");
        Integer state = stateCode(body.path("state"));
        Instant at = timestamp(body.path("timeStamp"));
        String key = (deliveryId.isEmpty() ? tracking : deliveryId) + ":" + state + ":"
                + (at == null ? body.path("timeStamp").asText("") : at.toEpochMilli());
        if (key.length() > 150) {
            key = key.substring(0, 150);
        }
        String eventKey = key;

        tx.executeWithoutResult(s -> {
            record Ship(long id, UUID orderId, String reference, String orderStatus, Instant stateAt) {
            }
            Ship ship = jdbc.sql("""
                    select s.id, o.id, o.reference, o.status, s.provider_state_at from shipments s
                    join orders o on o.id = s.order_id
                    where s.carrier = :c and ((:d <> '' and s.provider_delivery_id = :d)
                                              or (:t <> '' and s.tracking_reference = :t))
                    order by s.id desc limit 1 for update of s
                    """).param("c", CARRIER).param("d", deliveryId).param("t", tracking)
                    .query((rs, n) -> new Ship(rs.getLong(1), rs.getObject(2, UUID.class), rs.getString(3),
                            rs.getString(4), toInstant(rs.getObject(5, OffsetDateTime.class))))
                    .optional().orElse(null);

            int inserted = jdbc.sql("""
                    insert into shipment_events (shipment_id, provider, event_key, state, payload)
                    values (:s, :p, :k, :state, cast(:payload as jsonb))
                    on conflict (provider, event_key) do nothing
                    """).param("s", ship == null ? null : ship.id()).param("p", PROVIDER).param("k", eventKey)
                    .param("state", state).param("payload", body.toString()).update();
            if (inserted == 0 || ship == null || state == null) {
                if (ship == null && inserted > 0) {
                    log.warn("Bosta status for an unknown delivery (tracking {})", tracking);
                }
                return;
            }
            Instant when = at == null ? Instant.now() : at;
            if (ship.stateAt() != null && when.isBefore(ship.stateAt())) {
                return; // An older message arriving late; keep the newer state.
            }
            String label = label(body.path("state"), state);
            String exception = state == EXCEPTION ? exceptionText(body) : null;
            jdbc.sql("""
                    update shipments set provider_state = :st, provider_state_label = :label, provider_state_at = :at,
                           last_exception = coalesce(:ex, last_exception), updated_at = now()
                    where id = :id
                    """).param("st", state).param("label", label).param("at", when.atOffset(ZoneOffset.UTC))
                    .param("ex", exception).param("id", ship.id()).update();

            if (state == DELIVERED && "SHIPPED".equals(ship.orderStatus())) {
                orders.changeStatus(null, ship.reference(),
                        new StatusChange("DELIVERED", "Bosta reported the parcel delivered", null, null));
            } else if (state == RETURNED) {
                jdbc.sql("update shipments set status = 'RETURNED' where id = :id").param("id", ship.id()).update();
                audit.record(null, "SHIPMENT_RETURNED", "order", ship.reference(), Map.of("tracking", tracking));
            } else if (state == EXCEPTION || PROBLEM_STATES.contains(state)) {
                Map<String, Object> detail = new LinkedHashMap<>();
                detail.put("state", state);
                detail.put("label", label);
                if (exception != null) {
                    detail.put("exception", exception);
                }
                audit.record(null, "SHIPMENT_PROBLEM", "order", ship.reference(), detail);
            }
        });
    }

    static Integer stateCode(JsonNode state) {
        JsonNode code = state.isObject() ? state.path("code") : state;
        if (code.isInt() || code.isLong()) {
            return code.asInt();
        }
        if (code.isTextual() && code.asText().matches("\\d{1,4}")) {
            return Integer.parseInt(code.asText());
        }
        return null;
    }

    static String label(JsonNode state, int code) {
        String known = STATE_LABELS.get(code);
        if (known != null) {
            return known;
        }
        String given = state.isObject() ? state.path("value").asText("") : "";
        String label = given.isBlank() ? "Bosta status " + code : given.trim();
        return label.length() > 60 ? label.substring(0, 60) : label;
    }

    private static String exceptionText(JsonNode body) {
        String reason = body.path("exceptionReason").asText("");
        if (reason.isBlank()) {
            reason = body.path("exceptionCode").asText("");
        }
        reason = reason.isBlank() ? "Bosta reported a delivery problem" : reason.trim();
        return reason.length() > 300 ? reason.substring(0, 300) : reason;
    }

    /** Bosta sends milliseconds since epoch; accept ISO-8601 text too. */
    static Instant timestamp(JsonNode node) {
        if (node.isNumber()) {
            return Instant.ofEpochMilli(node.asLong());
        }
        if (node.isTextual()) {
            String t = node.asText();
            if (t.matches("\\d{10,13}")) {
                return Instant.ofEpochMilli(Long.parseLong(t));
            }
            try {
                return OffsetDateTime.parse(t).toInstant();
            } catch (RuntimeException e) {
                return null;
            }
        }
        return null;
    }

    private static Instant toInstant(OffsetDateTime t) {
        return t == null ? null : t.toInstant();
    }
}
