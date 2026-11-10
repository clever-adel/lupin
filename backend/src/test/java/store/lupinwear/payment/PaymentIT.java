package store.lupinwear.payment;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import store.lupinwear.catalog.api.CatalogDtos.CategoryRequest;
import store.lupinwear.catalog.api.CatalogDtos.ColorRequest;
import store.lupinwear.catalog.api.CatalogDtos.ProductRequest;
import store.lupinwear.order.OrderService;
import store.lupinwear.order.OrderService.PlaceOrderRequest;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.support.IntegrationTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Cash, manual InstaPay and Paymob (faked gateway, real signature check) against a real PostgreSQL. */
class PaymentIT extends IntegrationTest {

    static final String HMAC_SECRET = "test-hmac-secret"; // application-test.yml

    @Autowired
    JdbcClient jdbc;
    @Autowired
    OrderService orderService;
    @Autowired
    FakePaymob paymob;

    Cookie owner;
    String category;
    int optionId;
    long variant;
    Cookie customer;

    @BeforeEach
    void setUp() throws Exception {
        owner = ownerCookie();
        mvc.perform(patch("/api/v1/admin/departments/men").with(csrf()).cookie(owner)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        category = body(mvc.perform(jsonPost("/api/v1/admin/categories",
                new CategoryRequest("men", null, "Pay " + UUID.randomUUID().toString().substring(0, 8), "فئة"))
                .cookie(owner)).andExpect(status().isCreated()).andReturn()).get("slug").asText();

        jdbc.sql("update promotions set active = false").update();
        setting("checkout", "freeDeliveryThreshold", "null");
        setting("checkout", "unpaidOrderMinutes", "60");
        setting("payment_methods", "COD", "true");
        setting("payment_methods", "CARD", "true");
        setting("payment_methods", "WALLET", "false");   // has a Paymob integration id, but the owner switched it off
        setting("payment_methods", "FAWRY", "true");     // switched on, but no Paymob integration id is configured
        setting("payment_methods", "INSTAPAY_MANUAL", "true");
        setting("payment_methods", "instapayHandle", "\"lupin.test@instapay\"");

        optionId = jdbc.sql("""
                insert into delivery_options (code, type, name_en, name_ar, fee, active)
                values (:code, 'STANDARD', 'Standard', 'عادي', 60, true) returning id
                """).param("code", "pay-" + UUID.randomUUID().toString().substring(0, 8))
                .query(Integer.class).single();

        ProductRequest product = new ProductRequest("Pay Jacket", "منتج", "men", category, "", "", "", "", "", "",
                null, null, new BigDecimal("1000.00"), null, "ADULT", List.of("M"),
                List.of(new ColorRequest("Black", "أسود", "#0B0B0C", true, List.of())), 5);
        JsonNode created = body(mvc.perform(jsonPost("/api/v1/admin/products", product).cookie(owner))
                .andExpect(status().isCreated()).andReturn());
        mvc.perform(patch("/api/v1/admin/products/" + created.get("id").asLong() + "/status").with(csrf())
                .cookie(owner).contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        variant = created.get("variantIds").get(0).asLong();
        customer = cookie(register(uniqueEmail()), AuthCookies.ACCESS);
    }

    @Test
    void onlyUsableMethodsAreOfferedAndAccepted() throws Exception {
        mvc.perform(get("/api/v1/content/site"))
                .andExpect(jsonPath("$.paymentMethods.COD").value(true))
                .andExpect(jsonPath("$.paymentMethods.CARD").value(true))
                .andExpect(jsonPath("$.paymentMethods.WALLET").value(false))
                .andExpect(jsonPath("$.paymentMethods.FAWRY").value(false))
                .andExpect(jsonPath("$.paymentMethods.INSTAPAY_MANUAL").value(true))
                .andExpect(jsonPath("$.instapay.handle").value("lupin.test@instapay"));

        place("FAWRY").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PAYMENT_METHOD_UNAVAILABLE"));

        // An InstaPay switch without an address to send money to is not usable either.
        setting("payment_methods", "instapayHandle", "\"\"");
        mvc.perform(get("/api/v1/content/site"))
                .andExpect(jsonPath("$.paymentMethods.INSTAPAY_MANUAL").value(false))
                .andExpect(jsonPath("$.instapay").doesNotExist());
    }

    @Test
    void cashOrderIsPlacedWithAPendingCashPayment() throws Exception {
        String reference = reference(place("COD").andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.paymentAction").doesNotExist()));
        assertThat(paymentStatuses(reference)).containsExactly("COD:PENDING");
    }

    @Test
    void manualTransferIsPaidOnlyWhenStaffConfirmIt() throws Exception {
        String reference = reference(place("INSTAPAY_MANUAL").andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("AWAITING_PAYMENT"))
                .andExpect(jsonPath("$.paymentAction").value("TRANSFER")));

        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/payment/transfer", Map.of("reference", "IPN 12345678"))
                        .cookie(customer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("AWAITING_PAYMENT"))
                .andExpect(jsonPath("$.paymentStatus").value("VERIFYING"))
                .andExpect(jsonPath("$.transferReference").value("IPN 12345678"))
                .andExpect(jsonPath("$.canCancel").value(false));

        MvcResult listed = mvc.perform(get("/api/v1/admin/payments/transfers").cookie(owner))
                .andExpect(status().isOk()).andReturn();
        String paymentId = null;
        for (JsonNode row : body(listed)) {
            if (row.get("orderReference").asText().equals(reference)) {
                paymentId = row.get("paymentId").asText();
            }
        }
        assertThat(paymentId).isNotNull();

        // A customer cannot confirm their own transfer.
        mvc.perform(jsonPost("/api/v1/admin/payments/" + paymentId + "/confirm", Map.of()).cookie(customer))
                .andExpect(status().isForbidden());

        // Staff reject it; the customer may send a corrected reference.
        mvc.perform(jsonPost("/api/v1/admin/payments/" + paymentId + "/reject", Map.of("note", "not received"))
                .cookie(owner)).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/orders/" + reference).cookie(customer))
                .andExpect(jsonPath("$.paymentStatus").value("FAILED"))
                .andExpect(jsonPath("$.paymentAction").value("TRANSFER"));
        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/payment/transfer", Map.of("reference", "IPN 87654321"))
                .cookie(customer)).andExpect(status().isOk());

        mvc.perform(jsonPost("/api/v1/admin/payments/" + paymentId + "/confirm", Map.of()).cookie(owner))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/orders/" + reference).cookie(customer))
                .andExpect(jsonPath("$.status").value("PAID"))
                .andExpect(jsonPath("$.paymentStatus").value("PAID"));
        mvc.perform(jsonPost("/api/v1/admin/payments/" + paymentId + "/confirm", Map.of()).cookie(owner))
                .andExpect(status().isConflict());

        long audits = jdbc.sql("select count(*) from audit_logs where entity_type = 'payment' and entity_id = :id")
                .param("id", paymentId).query(Long.class).single();
        assertThat(audits).isEqualTo(2);
    }

    @Test
    void paymobOrderIsPaidOnlyByACorrectlySignedWebhookForTheRightAmount() throws Exception {
        String reference = reference(place("CARD").andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("AWAITING_PAYMENT"))
                .andExpect(jsonPath("$.paymentAction").value("PAYMOB")));

        String redirect = body(mvc.perform(jsonPost("/api/v1/orders/" + reference + "/payment/paymob", Map.of())
                .cookie(customer)).andExpect(status().isOk()).andReturn()).get("redirectUrl").asText();
        assertThat(redirect).startsWith("https://accept.paymob.com/unifiedcheckout/?publicKey=test-public-key&clientSecret=cs_test_")
                .doesNotContain("test-secret-key").doesNotContain(HMAC_SECRET);
        assertThat(paymob.lastRequest.amountCents()).isEqualTo(106_000);
        assertThat(paymob.lastRequest.integrationId()).isEqualTo(111);
        assertThat(paymob.lastRequest.notificationUrl()).isEqualTo("https://shop.example.test/api/v1/payments/webhooks/paymob");
        String providerOrder = jdbc.sql("select provider_order_id from payments p join orders o on o.id = p.order_id"
                + " where o.reference = :r and p.status = 'PENDING'").param("r", reference).query(String.class).single();

        // Coming back from Paymob's page changes nothing.
        mvc.perform(get("/api/v1/orders/" + reference).param("payment", "return").param("success", "true")
                .cookie(customer)).andExpect(jsonPath("$.status").value("AWAITING_PAYMENT"));

        // Forged, unsigned and tampered callbacks are refused.
        Map<String, Object> paid = transaction(7001, providerOrder, 106_000, true);
        webhook(paid, "00ff").andExpect(status().isUnauthorized());
        webhook(paid, null).andExpect(status().isUnauthorized());
        Map<String, Object> tampered = transaction(7001, providerOrder, 106_000, true);
        webhook(tampered, hmac(transaction(7001, providerOrder, 106_000, false))).andExpect(status().isUnauthorized());
        assertThat(orderStatus(reference)).isEqualTo("AWAITING_PAYMENT");

        // Correctly signed, but for less money than the order: recorded, not paid.
        Map<String, Object> cheap = transaction(7002, providerOrder, 100, true);
        webhook(cheap, hmac(cheap)).andExpect(status().isOk());
        assertThat(orderStatus(reference)).isEqualTo("AWAITING_PAYMENT");
        assertThat(eventError("txn:7002:true:false:false:false")).isEqualTo("AMOUNT_MISMATCH");

        // The real one. Delivered twice, applied once.
        webhook(paid, hmac(paid)).andExpect(status().isOk());
        webhook(paid, hmac(paid)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/orders/" + reference).cookie(customer))
                .andExpect(jsonPath("$.status").value("PAID"))
                .andExpect(jsonPath("$.paymentStatus").value("PAID"))
                .andExpect(jsonPath("$.paymentAction").doesNotExist())
                .andExpect(jsonPath("$.canCancel").value(false));
        long paidRows = jdbc.sql("select count(*) from order_status_history h join orders o on o.id = h.order_id"
                + " where o.reference = :r and h.to_status = 'PAID'").param("r", reference).query(Long.class).single();
        assertThat(paidRows).isEqualTo(1);
        assertThat(paymentStatuses(reference)).containsExactly("PAYMOB:PAID");
    }

    @Test
    void failedPaymentCanBeRetriedAndUnpaidOrdersExpire() throws Exception {
        String reference = reference(place("CARD").andExpect(status().isCreated()));
        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/payment/paymob", Map.of()).cookie(customer))
                .andExpect(status().isOk());
        String firstAttempt = pendingProviderOrder(reference);

        Map<String, Object> declined = transaction(7101, firstAttempt, 106_000, false);
        webhook(declined, hmac(declined)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/orders/" + reference).cookie(customer))
                .andExpect(jsonPath("$.status").value("AWAITING_PAYMENT"))
                .andExpect(jsonPath("$.paymentStatus").value("FAILED"))
                .andExpect(jsonPath("$.paymentAction").value("PAYMOB"));

        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/payment/paymob", Map.of()).cookie(customer))
                .andExpect(status().isOk());
        String secondAttempt = pendingProviderOrder(reference);
        assertThat(secondAttempt).isNotEqualTo(firstAttempt);

        // Never paid: after the window the order is cancelled and the stock is back on sale, with no undo.
        assertThat(reserved()).isEqualTo(1);
        clock.advance(Duration.ofMinutes(61));
        assertThat(orderService.expireUnpaid()).isGreaterThanOrEqualTo(1);
        assertThat(orderStatus(reference)).isEqualTo("CANCELLED");
        assertThat(reserved()).isZero();
        assertThat(jdbc.sql("select undo_expires_at is null from orders where reference = :r").param("r", reference)
                .query(Boolean.class).single()).isTrue();

        // Money that still arrives for the cancelled order is flagged for a refund, never silently kept as "paid order".
        Map<String, Object> late = transaction(7102, secondAttempt, 106_000, true);
        webhook(late, hmac(late)).andExpect(status().isOk());
        assertThat(orderStatus(reference)).isEqualTo("CANCELLED");
        assertThat(jdbc.sql("select payment_status from orders where reference = :r").param("r", reference)
                .query(String.class).single()).isEqualTo("REFUND_PENDING");
        assertThat(eventError("txn:7102:true:false:false:false")).isEqualTo("ORDER_CANCELLED_NEEDS_REFUND");
    }

    // ── helpers ──

    private ResultActions place(String method) throws Exception {
        mvc.perform(put("/api/v1/cart/items/" + variant).with(csrf()).cookie(customer)
                .contentType(MediaType.APPLICATION_JSON).content("{\"quantity\":1}")).andExpect(status().isOk());
        return mvc.perform(jsonPost("/api/v1/orders", new PlaceOrderRequest("Test Customer", "01012345678", 1,
                "Nasr City", "12 Example Street", null, optionId, null, method, new BigDecimal("1060.00"),
                "key-" + UUID.randomUUID())).cookie(customer));
    }

    private String reference(ResultActions placed) throws Exception {
        return body(placed.andReturn()).get("reference").asText();
    }

    /** A Paymob "transaction processed" callback body, shaped as in Paymob's documentation. */
    private Map<String, Object> transaction(long id, String providerOrder, long amountCents, boolean success) {
        Map<String, Object> obj = new LinkedHashMap<>();
        obj.put("id", id);
        obj.put("pending", false);
        obj.put("amount_cents", amountCents);
        obj.put("success", success);
        obj.put("is_auth", false);
        obj.put("is_capture", false);
        obj.put("is_standalone_payment", true);
        obj.put("is_voided", false);
        obj.put("is_refunded", false);
        obj.put("is_3d_secure", true);
        obj.put("integration_id", 111);
        obj.put("has_parent_transaction", false);
        obj.put("order", Map.of("id", Long.parseLong(providerOrder)));
        obj.put("created_at", "2026-11-10T08:00:00.000000");
        obj.put("currency", "EGP");
        obj.put("source_data", Map.of("pan", "2346", "type", "card", "sub_type", "MasterCard"));
        obj.put("error_occured", false);
        obj.put("owner", 4321);
        return Map.of("type", "TRANSACTION", "obj", obj);
    }

    /** Independent of the production code: Paymob's documented field order, written out by hand. */
    @SuppressWarnings("unchecked")
    private String hmac(Map<String, Object> body) {
        Map<String, Object> o = (Map<String, Object>) body.get("obj");
        Map<String, Object> source = (Map<String, Object>) o.get("source_data");
        String data = "" + o.get("amount_cents") + o.get("created_at") + o.get("currency") + o.get("error_occured")
                + o.get("has_parent_transaction") + o.get("id") + o.get("integration_id") + o.get("is_3d_secure")
                + o.get("is_auth") + o.get("is_capture") + o.get("is_refunded") + o.get("is_standalone_payment")
                + o.get("is_voided") + ((Map<String, Object>) o.get("order")).get("id") + o.get("owner")
                + o.get("pending") + source.get("pan") + source.get("sub_type") + source.get("type")
                + o.get("success");
        return PaymentService.sign(data, HMAC_SECRET);
    }

    /** No cookie and no CSRF token, exactly like a call from Paymob's servers. */
    private ResultActions webhook(Map<String, Object> body, String hmac) throws Exception {
        var request = post("/api/v1/payments/webhooks/paymob").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body));
        return mvc.perform(hmac == null ? request : request.param("hmac", hmac));
    }

    private String pendingProviderOrder(String reference) {
        return jdbc.sql("select provider_order_id from payments p join orders o on o.id = p.order_id"
                + " where o.reference = :r and p.status = 'PENDING'").param("r", reference).query(String.class).single();
    }

    private List<String> paymentStatuses(String reference) {
        return jdbc.sql("select p.provider || ':' || p.status from payments p join orders o on o.id = p.order_id"
                + " where o.reference = :r order by p.created_at").param("r", reference).query(String.class).list();
    }

    private String orderStatus(String reference) {
        return jdbc.sql("select status from orders where reference = :r").param("r", reference)
                .query(String.class).single();
    }

    private String eventError(String key) {
        return jdbc.sql("select error from payment_events where provider = 'PAYMOB' and event_key = :k")
                .param("k", key).query(String.class).single();
    }

    private int reserved() {
        return jdbc.sql("select reserved from inventory where variant_id = :v").param("v", variant)
                .query(Integer.class).single();
    }

    private void setting(String key, String field, String jsonValue) {
        jdbc.sql("update site_settings set value = jsonb_set(value, cast(:path as text[]), cast(:v as jsonb)) where key = :k")
                .param("path", "{" + field + "}").param("v", jsonValue).param("k", key).update();
    }
}
