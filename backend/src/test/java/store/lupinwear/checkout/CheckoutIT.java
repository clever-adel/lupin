package store.lupinwear.checkout;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import store.lupinwear.cart.CartService;
import store.lupinwear.catalog.api.CatalogDtos.CategoryRequest;
import store.lupinwear.catalog.api.CatalogDtos.ColorRequest;
import store.lupinwear.catalog.api.CatalogDtos.ProductRequest;
import store.lupinwear.order.OrderService;
import store.lupinwear.order.OrderService.PlaceOrderRequest;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.shared.ApiException;
import store.lupinwear.support.IntegrationTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Cart → quote → order → cancel → undo, against a real PostgreSQL. */
class CheckoutIT extends IntegrationTest {

    static final int CAIRO = 1;
    static final int GIZA = 2;
    static final int ALEXANDRIA = 3;

    @Autowired
    JdbcClient jdbc;
    @Autowired
    OrderService orderService;
    @Autowired
    CartService cartService;

    Cookie owner;
    String category;
    long categoryId;
    int optionId;

    @BeforeEach
    void setUp() throws Exception {
        owner = ownerCookie();
        mvc.perform(patch("/api/v1/admin/departments/men").with(csrf()).cookie(owner)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        String name = "Checkout " + UUID.randomUUID().toString().substring(0, 8);
        category = body(mvc.perform(jsonPost("/api/v1/admin/categories",
                new CategoryRequest("men", null, name, "فئة")).cookie(owner))
                .andExpect(status().isCreated()).andReturn()).get("slug").asText();
        categoryId = jdbc.sql("select id from categories where slug = :s").param("s", category)
                .query(Long.class).single();

        // Shared database: start every test from a known pricing state.
        jdbc.sql("update promotions set active = false").update();
        setting("payment_methods", "COD", "true");
        setting("payment_methods", "CARD", "false");
        setting("checkout", "freeDeliveryThreshold", "null");

        // Standard delivery: 60 in Cairo, 85 in Giza, not offered anywhere else.
        optionId = jdbc.sql("""
                insert into delivery_options (code, type, name_en, name_ar, estimate_en, estimate_ar, fee, active)
                values (:code, 'STANDARD', 'Standard', 'عادي', '2-4 days', '٢-٤ أيام', 60, true) returning id
                """).param("code", "std-" + UUID.randomUUID().toString().substring(0, 8))
                .query(Integer.class).single();
        jdbc.sql("insert into delivery_option_governorates values (:o, :g, null), (:o, :g2, 85)")
                .param("o", optionId).param("g", CAIRO).param("g2", GIZA).update();
    }

    @Test
    void bagUsesServerPricesAndRespectsStock() throws Exception {
        long variant = product("Bag Jacket", "1000.00", "800.00", 3);
        Customer customer = customer();

        setQuantity(customer, variant, 2)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(2))
                .andExpect(jsonPath("$.lines[0].unitPrice").value(800.00))
                .andExpect(jsonPath("$.subtotal").value(1600.00));
        setQuantity(customer, variant, 4)
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("INSUFFICIENT_STOCK"));
        setQuantity(customer, variant, 11).andExpect(status().isBadRequest());

        // Guest bag merged after sign-in: quantities add up but never beyond stock; unknown items are dropped.
        mvc.perform(jsonPost("/api/v1/cart/merge", Map.of("items", List.of(
                        Map.of("variantId", variant, "quantity", 5), Map.of("variantId", 999999999, "quantity", 1))))
                        .cookie(customer.cookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lines.length()").value(1))
                .andExpect(jsonPath("$.lines[0].quantity").value(3));

        mvc.perform(get("/api/v1/cart")).andExpect(status().isUnauthorized());
    }

    @Test
    void quoteAppliesTheBestSingleDiscountAndDeliveryRules() throws Exception {
        long variant = product("Quote Jacket", "1000.00", null, 10);
        Customer customer = customer();
        setQuantity(customer, variant, 2).andExpect(status().isOk());

        quote(customer, CAIRO, null)
                .andExpect(jsonPath("$.subtotal").value(2000.00))
                .andExpect(jsonPath("$.discount").value(0.00))
                .andExpect(jsonPath("$.delivery.fee").value(60.00))
                .andExpect(jsonPath("$.total").value(2060.00))
                .andExpect(jsonPath("$.readyToOrder").value(true));
        quote(customer, GIZA, null).andExpect(jsonPath("$.delivery.fee").value(85.00));
        quote(customer, ALEXANDRIA, null)
                .andExpect(jsonPath("$.issues[0].code").value("DELIVERY_UNAVAILABLE"))
                .andExpect(jsonPath("$.readyToOrder").value(false));

        promotion("Ten percent", true, "PERCENT", "10", null);          // automatic: 200 off
        String big = promotion("Big code", false, "FIXED", "300", 1);    // code: 300 off
        String small = promotion("Small code", false, "FIXED", "100", 1);

        quote(customer, CAIRO, null)
                .andExpect(jsonPath("$.discount").value(200.00))
                .andExpect(jsonPath("$.discountLabelEn").value("Ten percent"))
                .andExpect(jsonPath("$.total").value(1860.00));
        quote(customer, CAIRO, big)
                .andExpect(jsonPath("$.discount").value(300.00))
                .andExpect(jsonPath("$.promo.applied").value(true))
                .andExpect(jsonPath("$.total").value(1760.00));
        quote(customer, CAIRO, small)
                .andExpect(jsonPath("$.discount").value(200.00))
                .andExpect(jsonPath("$.promo.applied").value(false))
                .andExpect(jsonPath("$.promo.reason").value("BETTER_OFFER_APPLIED"));
        quote(customer, CAIRO, "NO-SUCH-CODE")
                .andExpect(jsonPath("$.promo.reason").value("NOT_FOUND"))
                .andExpect(jsonPath("$.total").value(1860.00));

        // Threshold is compared with the subtotal after discount (1800).
        setting("checkout", "freeDeliveryThreshold", "1800");
        quote(customer, CAIRO, null)
                .andExpect(jsonPath("$.delivery.free").value(true))
                .andExpect(jsonPath("$.delivery.listFee").value(60.00))
                .andExpect(jsonPath("$.total").value(1800.00));
        setting("checkout", "freeDeliveryThreshold", "1801");
        quote(customer, CAIRO, null).andExpect(jsonPath("$.delivery.free").value(false));
    }

    @Test
    void placingAnOrderReservesStockSnapshotsItAndIsSafeToRetry() throws Exception {
        long variant = product("Order Jacket", "1000.00", null, 5);
        Customer customer = customer();
        setQuantity(customer, variant, 2).andExpect(status().isOk());

        // A total the server does not agree with is refused and nothing is reserved.
        place(customer, request(null, "1.00", "key-wrong-total"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("PRICE_CHANGED"));
        assertThat(reserved(variant)).isZero();

        PlaceOrderRequest request = request(null, "2060.00", "key-" + UUID.randomUUID());
        JsonNode order = body(place(customer, request).andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.paymentStatus").value("PENDING"))
                .andExpect(jsonPath("$.total").value(2060.00))
                .andExpect(jsonPath("$.items[0].productNameEn").value("Order Jacket"))
                .andExpect(jsonPath("$.items[0].quantity").value(2))
                .andExpect(jsonPath("$.governorateEn").value("Cairo"))
                .andExpect(jsonPath("$.canCancel").value(true))
                .andReturn());
        String reference = order.get("reference").asText();
        assertThat(reference).matches("LP-\\d+");
        assertThat(reserved(variant)).isEqualTo(2);

        // The same request again (double click, lost response) returns the same order.
        JsonNode again = body(place(customer, request).andExpect(status().isCreated()).andReturn());
        assertThat(again.get("reference").asText()).isEqualTo(reference);
        assertThat(reserved(variant)).isEqualTo(2);

        mvc.perform(get("/api/v1/cart").cookie(customer.cookie)).andExpect(jsonPath("$.count").value(0));
        mvc.perform(get("/api/v1/orders").cookie(customer.cookie))
                .andExpect(jsonPath("$.total").value(1)).andExpect(jsonPath("$.items[0].itemCount").value(2));

        // Later price changes do not touch the order; another customer cannot see it.
        jdbc.sql("update products set price = 5000 where id = (select product_id from product_variants where id = :v)")
                .param("v", variant).update();
        mvc.perform(get("/api/v1/orders/" + reference).cookie(customer.cookie))
                .andExpect(jsonPath("$.items[0].unitPrice").value(1000.00));
        mvc.perform(get("/api/v1/orders/" + reference).cookie(customer().cookie)).andExpect(status().isNotFound());
    }

    @Test
    void aPaymentMethodTheOwnerHasNotEnabledIsRefused() throws Exception {
        long variant = product("Payment Jacket", "1000.00", null, 5);
        Customer customer = customer();
        setQuantity(customer, variant, 1).andExpect(status().isOk());

        PlaceOrderRequest card = new PlaceOrderRequest("Test Customer", "01012345678", CAIRO, "Nasr City",
                "12 Example Street", null, optionId, null, "CARD", new BigDecimal("1060.00"), "key-card-0001");
        place(customer, card).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PAYMENT_METHOD_UNAVAILABLE"));

        setting("payment_methods", "COD", "false");
        place(customer, request(null, "1060.00", "key-cod-off-01")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PAYMENT_METHOD_UNAVAILABLE"));
        assertThat(reserved(variant)).isZero();
    }

    @Test
    void cancelReleasesStockAndUndoRestoresItOnlyInsideTheWindow() throws Exception {
        long variant = product("Cancel Jacket", "1000.00", null, 2);
        Customer customer = customer();
        setQuantity(customer, variant, 2).andExpect(status().isOk());
        String reference = body(place(customer, request(null, "2060.00", "key-" + UUID.randomUUID()))
                .andExpect(status().isCreated()).andReturn()).get("reference").asText();

        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/cancel", Map.of()).cookie(customer.cookie))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.canUndo").value(true));
        assertThat(reserved(variant)).isZero();
        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/cancel", Map.of()).cookie(customer.cookie))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CANNOT_CANCEL"));

        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/undo-cancel", Map.of()).cookie(customer.cookie))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PENDING"));
        assertThat(reserved(variant)).isEqualTo(2);

        // Cancel again; someone else buys the stock; undo must refuse and leave everything consistent.
        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/cancel", Map.of()).cookie(customer.cookie))
                .andExpect(status().isOk());
        jdbc.sql("update inventory set on_hand = 1 where variant_id = :v").param("v", variant).update();
        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/undo-cancel", Map.of()).cookie(customer.cookie))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("OUT_OF_STOCK"));
        assertThat(reserved(variant)).isZero();

        // After the window (30 minutes by default) the order stays cancelled.
        jdbc.sql("update inventory set on_hand = 2 where variant_id = :v").param("v", variant).update();
        clock.advance(Duration.ofMinutes(31));
        Cookie fresh = cookie(login(customer.email, PASSWORD_OK), AuthCookies.ACCESS); // the old access token expired too
        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/undo-cancel", Map.of()).cookie(fresh))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("UNDO_EXPIRED"));

        long statuses = jdbc.sql("select count(*) from order_status_history h join orders o on o.id = h.order_id"
                + " where o.reference = :r").param("r", reference).query(Long.class).single();
        assertThat(statuses).isEqualTo(4); // placed, cancelled, restored, cancelled
    }

    @Test
    void promoCodeIsCountedOncePerCustomerAndGivenBackOnCancel() throws Exception {
        long variant = product("Promo Jacket", "1000.00", null, 10);
        String code = promotion("Welcome", false, "PERCENT", "10", 1);
        Customer customer = customer();

        setQuantity(customer, variant, 1).andExpect(status().isOk());
        String reference = body(place(customer, request(code, "960.00", "key-" + UUID.randomUUID()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.discountTotal").value(100.00))
                .andExpect(jsonPath("$.promoCode").value(code))
                .andReturn()).get("reference").asText();
        assertThat(redeemed(code)).isEqualTo(1);

        setQuantity(customer, variant, 1).andExpect(status().isOk());
        quote(customer, CAIRO, code)
                .andExpect(jsonPath("$.promo.applied").value(false))
                .andExpect(jsonPath("$.promo.reason").value("ALREADY_USED"))
                .andExpect(jsonPath("$.total").value(1060.00));

        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/cancel", Map.of()).cookie(customer.cookie))
                .andExpect(status().isOk());
        assertThat(redeemed(code)).isZero();
        quote(customer, CAIRO, code).andExpect(jsonPath("$.promo.applied").value(true));
    }

    @Test
    void concurrentOrdersNeverOversell() throws Exception {
        int stock = 3;
        int buyers = 8;
        long variant = product("Last Pieces", "1000.00", null, stock);
        List<UUID> users = new ArrayList<>();
        for (int i = 0; i < buyers; i++) {
            UUID user = customer().id;
            cartService.setQuantity(user, variant, 1);
            users.add(user);
        }

        ExecutorService pool = Executors.newFixedThreadPool(buyers);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<String>> results = new ArrayList<>();
        for (UUID user : users) {
            Callable<String> attempt = () -> {
                start.await();
                try {
                    orderService.place(user, request(null, "1060.00", "key-" + UUID.randomUUID()));
                    return "PLACED";
                } catch (ApiException e) {
                    return e.code();
                }
            };
            results.add(pool.submit(attempt));
        }
        start.countDown();
        List<String> outcomes = new ArrayList<>();
        for (Future<String> result : results) {
            outcomes.add(result.get());
        }
        pool.shutdown();

        assertThat(outcomes).filteredOn("PLACED"::equals).hasSize(stock);
        assertThat(outcomes).filteredOn(o -> !"PLACED".equals(o)).hasSize(buyers - stock)
                .allMatch(o -> o.equals("OUT_OF_STOCK") || o.equals("BAG_CHANGED"));
        assertThat(reserved(variant)).isEqualTo(stock);
        long orders = jdbc.sql("select count(*) from order_items where variant_id = :v").param("v", variant)
                .query(Long.class).single();
        assertThat(orders).isEqualTo(stock);
    }

    @Test
    void publicContentAndDeliveryEndpointsExposeOnlyWhatIsPublished() throws Exception {
        mvc.perform(get("/api/v1/delivery/governorates")).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(27));
        mvc.perform(get("/api/v1/delivery/options").param("governorateId", String.valueOf(GIZA)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id==" + optionId + ")].fee").value(85.00));
        mvc.perform(get("/api/v1/content/site")).andExpect(status().isOk())
                .andExpect(jsonPath("$.brand.storeName").value("LUPIN."))
                .andExpect(jsonPath("$.paymentMethods.COD").value(true))
                .andExpect(jsonPath("$.paymentMethods.instapayHandle").doesNotExist())
                .andExpect(jsonPath("$.policies.length()").value(0)); // all policies are still drafts
        mvc.perform(get("/api/v1/content/policies/privacy")).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/content/faq")).andExpect(status().isOk());
    }

    // ── helpers ──

    record Customer(UUID id, String email, Cookie cookie) {
    }

    private Customer customer() throws Exception {
        String email = uniqueEmail();
        MvcResult registered = register(email);
        UUID id = jdbc.sql("select id from users where email = :e").param("e", email).query(UUID.class).single();
        return new Customer(id, email, cookie(registered, AuthCookies.ACCESS));
    }

    /** Publishes a one-colour, one-size product in this test's category and returns its variant id. */
    private long product(String name, String price, String salePrice, int stock) throws Exception {
        ProductRequest request = new ProductRequest(name, "منتج تجريبي", "men", category, "", "", "", "", "", "",
                null, null, new BigDecimal(price), salePrice == null ? null : new BigDecimal(salePrice), "ADULT",
                List.of("M"), List.of(new ColorRequest("Black", "أسود", "#0B0B0C", true, List.of())), stock);
        JsonNode created = body(mvc.perform(jsonPost("/api/v1/admin/products", request).cookie(owner))
                .andExpect(status().isCreated()).andReturn());
        mvc.perform(patch("/api/v1/admin/products/" + created.get("id").asLong() + "/status").with(csrf())
                .cookie(owner).contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        return created.get("variantIds").get(0).asLong();
    }

    /** A promotion limited to this test's category. Returns its code when it is not automatic. */
    private String promotion(String name, boolean automatic, String type, String value, Integer perCustomer) {
        long id = jdbc.sql("""
                insert into promotions (name_en, name_ar, automatic, type, value, scope, active)
                values (:n, :n, :auto, :type, :value, 'CATEGORY', true) returning id
                """).param("n", name).param("auto", automatic).param("type", type)
                .param("value", new BigDecimal(value)).query(Long.class).single();
        jdbc.sql("insert into promotion_targets values (:p, :c)").param("p", id).param("c", categoryId).update();
        if (automatic) {
            return null;
        }
        String code = "T" + UUID.randomUUID().toString().replace("-", "").substring(0, 10).toUpperCase();
        jdbc.sql("insert into promo_codes (code, promotion_id, per_customer_limit) values (:c, :p, :l)")
                .param("c", code).param("p", id).param("l", perCustomer).update();
        return code;
    }

    private void setting(String key, String field, String jsonValue) {
        jdbc.sql("update site_settings set value = jsonb_set(value, cast(:path as text[]), cast(:v as jsonb)) where key = :k")
                .param("path", "{" + field + "}").param("v", jsonValue).param("k", key).update();
    }

    private PlaceOrderRequest request(String promoCode, String expectedTotal, String key) {
        return new PlaceOrderRequest("Test Customer", "01012345678", CAIRO, "Nasr City", "12 Example Street", null,
                optionId, promoCode, "COD", new BigDecimal(expectedTotal), key);
    }

    private ResultActions setQuantity(Customer customer, long variant, int quantity) throws Exception {
        return mvc.perform(put("/api/v1/cart/items/" + variant).with(csrf()).cookie(customer.cookie)
                .contentType(MediaType.APPLICATION_JSON).content("{\"quantity\":" + quantity + "}"));
    }

    private ResultActions quote(Customer customer, int governorate, String promoCode) throws Exception {
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("governorateId", governorate);
        body.put("deliveryOptionId", optionId);
        body.put("promoCode", promoCode);
        return mvc.perform(jsonPost("/api/v1/checkout/quote", body).cookie(customer.cookie))
                .andExpect(status().isOk());
    }

    private ResultActions place(Customer customer, PlaceOrderRequest request) throws Exception {
        return mvc.perform(jsonPost("/api/v1/orders", request).cookie(customer.cookie));
    }

    private int reserved(long variant) {
        return jdbc.sql("select reserved from inventory where variant_id = :v").param("v", variant)
                .query(Integer.class).single();
    }

    private int redeemed(String code) {
        return jdbc.sql("select redeemed_count from promo_codes where code = :c").param("c", code)
                .query(Integer.class).single();
    }
}
