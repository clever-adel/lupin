package store.lupinwear.shipping;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.ResultActions;
import store.lupinwear.auth.domain.Role;
import store.lupinwear.catalog.api.CatalogDtos.CategoryRequest;
import store.lupinwear.catalog.api.CatalogDtos.ColorRequest;
import store.lupinwear.catalog.api.CatalogDtos.ProductRequest;
import store.lupinwear.order.OrderService.PlaceOrderRequest;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.support.IntegrationTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Sending orders with Bosta and Bosta's status messages, against the real database and a fake Bosta API. */
class ShippingIT extends IntegrationTest {

    static final String SECRET = "test-bosta-webhook-secret-0123456789";

    @Autowired
    JdbcClient jdbc;
    @Autowired
    FakeBosta bosta;

    Cookie owner;
    Cookie admin;
    Cookie customer;
    int optionId;
    long variant;

    @BeforeEach
    void setUp() throws Exception {
        owner = ownerCookie();
        admin = staffCookie(Role.ADMIN);
        mvc.perform(patch("/api/v1/admin/departments/men").with(csrf()).cookie(owner)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        String category = body(mvc.perform(jsonPost("/api/v1/admin/categories",
                new CategoryRequest("men", null, "Ship " + UUID.randomUUID().toString().substring(0, 8), "فئة"))
                .cookie(owner)).andExpect(status().isCreated()).andReturn()).get("slug").asText();
        jdbc.sql("update promotions set active = false").update();
        setting("checkout", "freeDeliveryThreshold", "null");
        setting("payment_methods", "COD", "true");
        setting("payment_methods", "INSTAPAY_MANUAL", "true");
        setting("payment_methods", "instapayHandle", "\"lupin.test@instapay\"");
        optionId = body(mvc.perform(jsonPost("/api/v1/admin/delivery/options", Map.of("type", "STANDARD",
                "nameEn", "Standard", "nameAr", "عادي", "estimateEn", "2-4 days", "estimateAr", "٢-٤ أيام",
                "fee", new BigDecimal("60.00"), "active", true, "sortOrder", 1, "governorates", List.of()))
                .cookie(admin)).andExpect(status().isCreated()).andReturn()).get("id").asInt();
        ProductRequest product = new ProductRequest("Ship Hoodie " + UUID.randomUUID().toString().substring(0, 6),
                "منتج", "men", category, "", "", "", "", "", "", null, null, new BigDecimal("1000.00"), null,
                "ADULT", List.of("M"), List.of(new ColorRequest("Black", "أسود", "#0B0B0C", true, List.of())), 5);
        JsonNode created = body(mvc.perform(jsonPost("/api/v1/admin/products", product).cookie(owner))
                .andExpect(status().isCreated()).andReturn());
        mvc.perform(patch("/api/v1/admin/products/" + created.get("id").asLong() + "/status").with(csrf())
                .cookie(owner).contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        variant = created.get("variantIds").get(0).asLong();
        customer = cookie(register(uniqueEmail()), AuthCookies.ACCESS);
    }

    @Test
    void cashOrderIsSentWithBostaAndFollowedToDelivery() throws Exception {
        String reference = processingCashOrder(2);

        mvc.perform(get("/api/v1/admin/orders/" + reference + "/bosta").cookie(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.configured").value(true))
                .andExpect(jsonPath("$.cityName").value("Cairo"))
                .andExpect(jsonPath("$.deliverable").value(true))
                .andExpect(jsonPath("$.districts.length()").value(2)) // the closed district is not offered
                .andExpect(jsonPath("$.suggestedDistrictId").value("d-nasr-FceDyHXwpSYYF9zGW"))
                .andExpect(jsonPath("$.codAmount").value(2060.00))
                .andExpect(jsonPath("$.canSend").value(true));

        // A district from another city is refused.
        send(reference, "d-nasr-0064Qb0OgcA").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BOSTA_DISTRICT"));

        JsonNode view = body(send(reference, "d-nasr-FceDyHXwpSYYF9zGW").andExpect(status().isOk()).andReturn());
        assertThat(view.at("/order/status").asText()).isEqualTo("SHIPPED");
        assertThat(view.at("/shipment/carrier").asText()).isEqualTo("Bosta");
        String tracking = view.at("/shipment/trackingReference").asText();
        assertThat(tracking).isNotBlank();
        assertThat(view.at("/shipment/courierStateLabel").asText()).isEqualTo("Pickup requested");
        assertThat(view.at("/shipment/codAmount").decimalValue()).isEqualByComparingTo("2060.00");

        var d = bosta.lastDelivery;
        assertThat(d.businessReference()).isEqualTo(reference);
        assertThat(d.cod()).isEqualByComparingTo("2060.00");
        assertThat(d.cityName()).isEqualTo("Cairo");
        assertThat(d.firstName()).isEqualTo("Test");
        assertThat(d.lastName()).isEqualTo("Customer");
        assertThat(d.phone()).isEqualTo("01012345678");
        assertThat(d.itemsCount()).isEqualTo(2);
        assertThat(d.packageDescription()).contains("2x Ship Hoodie").contains("Black M");
        assertThat(d.webhookUrl()).isEqualTo("https://shop.example.test/api/v1/shipping/webhooks/bosta");
        assertThat(d.webhookSecret()).isEqualTo(SECRET);
        assertThat(stock()).containsExactly(3, 0); // stock left with the parcel

        // Sending twice is refused and Bosta is not called again.
        int calls = bosta.created.get();
        send(reference, "d-nasr-FceDyHXwpSYYF9zGW").andExpect(status().isConflict());
        assertThat(bosta.created.get()).isEqualTo(calls);

        // The customer sees who carries it and the tracking number, nothing else of the shipment.
        mvc.perform(get("/api/v1/orders/" + reference).cookie(customer))
                .andExpect(jsonPath("$.carrier").value("Bosta"))
                .andExpect(jsonPath("$.trackingNumber").value(tracking));

        String deliveryId = "bosta-id-" + tracking;
        long t = Instant.now().toEpochMilli();
        webhook(SECRET, event(deliveryId, tracking, 41, t)).andExpect(status().isOk());
        assertThat(state(reference)).isEqualTo("Out for delivery");

        // A problem is recorded and counted on the dashboard.
        webhook(SECRET, Map.of("_id", deliveryId, "trackingNumber", tracking, "state", 47, "timeStamp", t + 1000,
                "exceptionReason", "Customer not answering")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/admin/orders/" + reference).cookie(admin))
                .andExpect(jsonPath("$.shipment.courierState").value(47))
                .andExpect(jsonPath("$.shipment.lastException").value("Customer not answering"));
        mvc.perform(get("/api/v1/admin/summary").cookie(admin))
                .andExpect(jsonPath("$.shipmentsNeedingAttention").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)));

        // An older message arriving late does not move the state back.
        webhook(SECRET, event(deliveryId, tracking, 24, t - 5000)).andExpect(status().isOk());
        assertThat(state(reference)).isEqualTo("Delivery problem");

        // Delivered: the order completes and the cash counts as collected. Repeats change nothing.
        webhook(SECRET, event(deliveryId, tracking, 45, t + 2000)).andExpect(status().isOk());
        webhook(SECRET, event(deliveryId, tracking, 45, t + 2000)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/admin/orders/" + reference).cookie(admin))
                .andExpect(jsonPath("$.order.status").value("DELIVERED"))
                .andExpect(jsonPath("$.order.paymentStatus").value("PAID"))
                .andExpect(jsonPath("$.shipment.status").value("DELIVERED"))
                .andExpect(jsonPath("$.shipment.courierStateLabel").value("Delivered"));
        long events = jdbc.sql("select count(*) from shipment_events where payload ->> 'trackingNumber' = :t")
                .param("t", tracking).query(Long.class).single();
        assertThat(events).isEqualTo(4);
        long deliveredRows = jdbc.sql("""
                select count(*) from order_status_history h join orders o on o.id = h.order_id
                where o.reference = :r and h.to_status = 'DELIVERED'
                """).param("r", reference).query(Long.class).single();
        assertThat(deliveredRows).isEqualTo(1);
    }

    @Test
    void webhookNeedsTheSecretAndIgnoresUnknownDeliveries() throws Exception {
        webhook(null, event("x", "1", 45, 1L)).andExpect(status().isUnauthorized());
        webhook("wrong-secret-wrong-secret-wrong", event("x", "1", 45, 1L)).andExpect(status().isUnauthorized());
        // Unknown delivery: accepted (so Bosta stops retrying) and stored, nothing else happens.
        webhook(SECRET, event("unknown-" + UUID.randomUUID(), "999", 45, 1L)).andExpect(status().isOk());
    }

    @Test
    void returnedParcelIsMarkedAndFlagged() throws Exception {
        String reference = processingCashOrder(1);
        JsonNode view = body(send(reference, "d-maadi-FceDyHXwpSYYF9zGW").andExpect(status().isOk()).andReturn());
        String tracking = view.at("/shipment/trackingReference").asText();
        webhook(SECRET, event("bosta-id-" + tracking, tracking, 46, Instant.now().toEpochMilli()))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/admin/orders/" + reference).cookie(admin))
                .andExpect(jsonPath("$.order.status").value("SHIPPED"))
                .andExpect(jsonPath("$.shipment.status").value("RETURNED"))
                .andExpect(jsonPath("$.shipment.courierStateLabel").value("Returned to you"));
        long audits = jdbc.sql("select count(*) from audit_logs where action = 'SHIPMENT_RETURNED' and entity_id = :r")
                .param("r", reference).query(Long.class).single();
        assertThat(audits).isEqualTo(1);
    }

    @Test
    void onlyPreparedOrdersInDeliverableAreasCanBeSent() throws Exception {
        String reference = placeOrder("COD", 1);
        // Still PENDING.
        mvc.perform(get("/api/v1/admin/orders/" + reference + "/bosta").cookie(admin))
                .andExpect(jsonPath("$.canSend").value(false))
                .andExpect(jsonPath("$.reason").value(org.hamcrest.Matchers.containsString("PROCESSING")));
        send(reference, "d-nasr-FceDyHXwpSYYF9zGW").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BOSTA_NOT_ALLOWED"));

        move(reference, "CONFIRMED");
        move(reference, "PROCESSING");
        jdbc.sql("update orders set governorate_id = (select id from governorates where code = 'north-sinai')"
                + " where reference = :r").param("r", reference).update();
        mvc.perform(get("/api/v1/admin/orders/" + reference + "/bosta").cookie(admin))
                .andExpect(jsonPath("$.deliverable").value(false))
                .andExpect(jsonPath("$.canSend").value(false));
        send(reference, "d-nasr-FceDyHXwpSYYF9zGW").andExpect(status().isConflict());
        assertThat(bosta.lastDelivery == null || !reference.equals(bosta.lastDelivery.businessReference())).isTrue();
    }

    @Test
    void alreadyPaidOrderCollectsNothingAtTheDoor() throws Exception {
        String reference = placeOrder("INSTAPAY_MANUAL", 1);
        jdbc.sql("update orders set status = 'PROCESSING', payment_status = 'PAID' where reference = :r")
                .param("r", reference).update();
        send(reference, "d-nasr-FceDyHXwpSYYF9zGW").andExpect(status().isOk());
        assertThat(bosta.lastDelivery.cod()).isEqualByComparingTo("0");
    }

    @Test
    void bostaRefusalLeavesTheOrderUntouched() throws Exception {
        String reference = processingCashOrder(1);
        bosta.failNext = new store.lupinwear.shared.ApiException(org.springframework.http.HttpStatus.BAD_GATEWAY,
                "BOSTA_REJECTED", "Bosta refused this delivery: District Not Found");
        send(reference, "d-nasr-FceDyHXwpSYYF9zGW").andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("BOSTA_REJECTED"));
        mvc.perform(get("/api/v1/admin/orders/" + reference).cookie(admin))
                .andExpect(jsonPath("$.order.status").value("PROCESSING"))
                .andExpect(jsonPath("$.shipment").doesNotExist());
        assertThat(stock()).containsExactly(5, 1);
    }

    @Test
    void customersCannotUseTheBostaEndpoints() throws Exception {
        String reference = processingCashOrder(1);
        mvc.perform(get("/api/v1/admin/orders/" + reference + "/bosta").cookie(customer))
                .andExpect(status().isForbidden());
        mvc.perform(jsonPost("/api/v1/admin/orders/" + reference + "/bosta",
                Map.of("districtId", "d-nasr-FceDyHXwpSYYF9zGW")).cookie(customer)).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/admin/orders/" + reference + "/bosta")).andExpect(status().isUnauthorized());
    }

    // ── helpers ──

    private String processingCashOrder(int quantity) throws Exception {
        String reference = placeOrder("COD", quantity);
        move(reference, "CONFIRMED");
        move(reference, "PROCESSING");
        return reference;
    }

    private String placeOrder(String method, int quantity) throws Exception {
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/v1/cart/items/" + variant)
                .with(csrf()).cookie(customer).contentType(MediaType.APPLICATION_JSON)
                .content("{\"quantity\":" + quantity + "}")).andExpect(status().isOk());
        BigDecimal total = new BigDecimal("1000.00").multiply(BigDecimal.valueOf(quantity)).add(new BigDecimal("60.00"));
        return body(mvc.perform(jsonPost("/api/v1/orders", new PlaceOrderRequest("Test Customer", "01012345678", 1,
                "Nasr City", "12 Example Street", null, optionId, null, method, total, "key-" + UUID.randomUUID()))
                .cookie(customer)).andExpect(status().isCreated()).andReturn()).get("reference").asText();
    }

    private void move(String reference, String to) throws Exception {
        mvc.perform(jsonPost("/api/v1/admin/orders/" + reference + "/status", Map.of("status", to)).cookie(admin))
                .andExpect(status().isOk());
    }

    private ResultActions send(String reference, String districtId) throws Exception {
        return mvc.perform(jsonPost("/api/v1/admin/orders/" + reference + "/bosta",
                Map.of("districtId", districtId, "notes", "Call before arriving")).cookie(admin));
    }

    private ResultActions webhook(String secret, Map<String, Object> body) throws Exception {
        var request = post("/api/v1/shipping/webhooks/bosta").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body));
        if (secret != null) {
            request.header("X-Lupin-Webhook-Key", secret);
        }
        return mvc.perform(request);
    }

    private static Map<String, Object> event(String id, String tracking, int state, long timeStamp) {
        return Map.of("_id", id, "trackingNumber", tracking, "state", state, "timeStamp", timeStamp);
    }

    private String state(String reference) {
        return jdbc.sql("select s.provider_state_label from shipments s join orders o on o.id = s.order_id"
                + " where o.reference = :r order by s.id desc limit 1").param("r", reference).query(String.class).single();
    }

    private List<Integer> stock() {
        return jdbc.sql("select on_hand, reserved from inventory where variant_id = :v").param("v", variant)
                .query((rs, n) -> List.of(rs.getInt(1), rs.getInt(2))).single();
    }

    private void setting(String key, String field, String jsonValue) {
        jdbc.sql("update site_settings set value = jsonb_set(value, cast(:path as text[]), cast(:v as jsonb)) where key = :k")
                .param("path", "{" + field + "}").param("v", jsonValue).param("k", key).update();
    }
}
