package store.lupinwear.admin;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The staff side: order workflow, stock leaving on shipment, delivery fees and settings. */
class AdminIT extends IntegrationTest {

    @Autowired
    JdbcClient jdbc;

    Cookie owner;
    Cookie admin;
    Cookie customer;
    String category;
    int optionId;
    long variant;

    @BeforeEach
    void setUp() throws Exception {
        owner = ownerCookie();
        admin = staffCookie(Role.ADMIN);
        mvc.perform(patch("/api/v1/admin/departments/men").with(csrf()).cookie(owner)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        category = body(mvc.perform(jsonPost("/api/v1/admin/categories",
                new CategoryRequest("men", null, "Adm " + UUID.randomUUID().toString().substring(0, 8), "فئة"))
                .cookie(owner)).andExpect(status().isCreated()).andReturn()).get("slug").asText();
        jdbc.sql("update promotions set active = false").update();
        setting("checkout", "freeDeliveryThreshold", "null");
        setting("payment_methods", "COD", "true");
        setting("payment_methods", "INSTAPAY_MANUAL", "true");
        setting("payment_methods", "instapayHandle", "\"lupin.test@instapay\"");

        optionId = body(mvc.perform(jsonPost("/api/v1/admin/delivery/options", deliveryOption("60.00", true, List.of()))
                .cookie(admin)).andExpect(status().isCreated()).andReturn()).get("id").asInt();

        ProductRequest product = new ProductRequest("Admin Jacket " + UUID.randomUUID().toString().substring(0, 6),
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
    void cashOrderMovesThroughTheWorkflowAndStockLeavesWhenItShips() throws Exception {
        String reference = place("COD", 2);
        assertThat(stock()).containsExactly(5, 2); // on hand, reserved

        // Customers cannot reach any staff endpoint.
        mvc.perform(get("/api/v1/admin/orders").cookie(customer)).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/admin/orders")).andExpect(status().isUnauthorized());

        mvc.perform(get("/api/v1/admin/orders").param("q", reference).cookie(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].status").value("PENDING"))
                .andExpect(jsonPath("$.items[0].itemCount").value(2));
        mvc.perform(get("/api/v1/admin/orders/" + reference).cookie(admin))
                .andExpect(jsonPath("$.nextStatuses[0]").value("CONFIRMED"))
                .andExpect(jsonPath("$.payments[0].provider").value("COD"));

        // Steps cannot be skipped.
        move(reference, "SHIPPED", admin).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_TRANSITION"));

        move(reference, "CONFIRMED", admin).andExpect(status().isOk());
        move(reference, "PROCESSING", admin).andExpect(status().isOk());
        // Once it is being prepared the customer can no longer cancel on their own.
        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/cancel", Map.of()).cookie(customer))
                .andExpect(status().isConflict());

        mvc.perform(jsonPost("/api/v1/admin/orders/" + reference + "/status",
                        Map.of("status", "SHIPPED", "carrier", "Test Courier", "trackingReference", "TRK-1"))
                        .cookie(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shipment.trackingReference").value("TRK-1"))
                .andExpect(jsonPath("$.nextStatuses[0]").value("DELIVERED"));
        assertThat(stock()).containsExactly(3, 0);
        move(reference, "CANCELLED", admin).andExpect(status().isConflict());

        move(reference, "DELIVERED", admin).andExpect(status().isOk())
                .andExpect(jsonPath("$.order.status").value("DELIVERED"))
                .andExpect(jsonPath("$.order.paymentStatus").value("PAID"))   // cash collected at the door
                .andExpect(jsonPath("$.payments[0].status").value("PAID"))
                .andExpect(jsonPath("$.history.length()").value(5))
                .andExpect(jsonPath("$.nextStatuses.length()").value(0));

        // The customer sees the same journey.
        mvc.perform(get("/api/v1/orders/" + reference).cookie(customer))
                .andExpect(jsonPath("$.status").value("DELIVERED"))
                .andExpect(jsonPath("$.history.length()").value(5));
        long audits = jdbc.sql("select count(*) from audit_logs where action = 'ORDER_STATUS' and entity_id = :r")
                .param("r", reference).query(Long.class).single();
        assertThat(audits).isEqualTo(4);
    }

    @Test
    void staffCancelReleasesStockAndFlagsPaidOrdersForRefund() throws Exception {
        String reference = place("INSTAPAY_MANUAL", 1);
        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/payment/transfer", Map.of("reference", "IPN 5555"))
                .cookie(customer)).andExpect(status().isOk());
        String paymentId = jdbc.sql("select p.id::text from payments p join orders o on o.id = p.order_id"
                + " where o.reference = :r").param("r", reference).query(String.class).single();
        mvc.perform(jsonPost("/api/v1/admin/payments/" + paymentId + "/confirm", Map.of()).cookie(admin))
                .andExpect(status().isNoContent());
        assertThat(stock()).containsExactly(5, 1);

        mvc.perform(jsonPost("/api/v1/admin/orders/" + reference + "/status",
                        Map.of("status", "CANCELLED", "note", "Customer phoned to cancel")).cookie(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.order.status").value("CANCELLED"))
                .andExpect(jsonPath("$.order.paymentStatus").value("REFUND_PENDING"))
                .andExpect(jsonPath("$.order.canUndo").value(false))
                .andExpect(jsonPath("$.history[-1:].note").value("Customer phoned to cancel"));
        assertThat(stock()).containsExactly(5, 0);

        mvc.perform(get("/api/v1/admin/summary").cookie(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.refundsPending").isNumber())
                .andExpect(jsonPath("$.ordersByStatus.PENDING").isNumber());
    }

    @Test
    void deliveryFeesAreEditedByStaffAndSeenByCustomers() throws Exception {
        mvc.perform(get("/api/v1/delivery/options").param("governorateId", "3"))
                .andExpect(jsonPath("$[?(@.id==" + optionId + ")].fee").value(60.00));

        // Now only Cairo (standard fee 70) and Giza (95); switched off elsewhere.
        mvc.perform(put("/api/v1/admin/delivery/options/" + optionId).with(csrf()).cookie(admin)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(deliveryOption("70.00", true,
                        List.of(Map.of("governorateId", 1), Map.of("governorateId", 2, "feeOverride", 95))))))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/delivery/options").param("governorateId", "1"))
                .andExpect(jsonPath("$[?(@.id==" + optionId + ")].fee").value(70.00));
        mvc.perform(get("/api/v1/delivery/options").param("governorateId", "2"))
                .andExpect(jsonPath("$[?(@.id==" + optionId + ")].fee").value(95.00));
        mvc.perform(get("/api/v1/delivery/options").param("governorateId", "3"))
                .andExpect(jsonPath("$[?(@.id==" + optionId + ")]").isEmpty());

        mvc.perform(get("/api/v1/admin/delivery/options").cookie(admin))
                .andExpect(jsonPath("$[?(@.id==" + optionId + ")].governorates.length()").value(2));
        mvc.perform(jsonPost("/api/v1/admin/delivery/options", deliveryOption("-1", true, List.of())).cookie(admin))
                .andExpect(status().isBadRequest());
        mvc.perform(jsonPost("/api/v1/admin/delivery/options", deliveryOption("10", true, List.of())).cookie(customer))
                .andExpect(status().isForbidden());
    }

    @Test
    void settingsAreValidatedAndPaymentSettingsBelongToTheOwner() throws Exception {
        // Announcement bar: any staff member.
        putSetting("announcement", Map.of("itemsEn", List.of("New season"), "itemsAr", List.of("موسم جديد")), admin)
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/content/site")).andExpect(jsonPath("$.announcement.itemsEn[0]").value("New season"));

        // Unknown fields and wrong kinds of value are refused.
        putSetting("announcement", Map.of("script", "x"), admin).andExpect(status().isBadRequest());
        putSetting("home_sections", Map.of("offers", "yes"), admin).andExpect(status().isBadRequest());
        putSetting("brand", Map.of("storeName", "Other"), owner).andExpect(status().isNotFound());

        // Where money goes: owner only.
        putSetting("payment_methods", Map.of("instapayHandle", "attacker@instapay"), admin)
                .andExpect(status().isForbidden());
        putSetting("payment_methods", Map.of("COD", false), owner).andExpect(status().isOk());
        mvc.perform(get("/api/v1/content/site")).andExpect(jsonPath("$.paymentMethods.COD").value(false));
        putSetting("payment_methods", Map.of("instapayHandle", ""), owner).andExpect(status().isBadRequest());

        putSetting("checkout", Map.of("cancelUndoMinutes", 100000), owner).andExpect(status().isBadRequest());
        putSetting("checkout", Map.of("freeDeliveryThreshold", 3000, "unpaidOrderMinutes", 90), owner)
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/content/site")).andExpect(jsonPath("$.freeDeliveryThreshold").value(3000));

        long audits = jdbc.sql("select count(*) from audit_logs where action = 'SETTING_UPDATE'"
                + " and created_at > now() - interval '1 minute'").query(Long.class).single();
        assertThat(audits).isGreaterThanOrEqualTo(3);
    }

    @Test
    void productListShowsEveryStatusWithStockPerVariant() throws Exception {
        place("COD", 1);
        mvc.perform(get("/api/v1/admin/products").param("q", "Admin Jacket").param("pageSize", "50").cookie(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.variants[0].variantId==" + variant + ")].status").value("ACTIVE"))
                .andExpect(jsonPath("$.items[?(@.variants[0].variantId==" + variant + ")].variants[0].onHand").value(5))
                .andExpect(jsonPath("$.items[?(@.variants[0].variantId==" + variant + ")].variants[0].reserved").value(1))
                .andExpect(jsonPath("$.items[?(@.variants[0].variantId==" + variant + ")].variants[0].available").value(4));
    }

    // ── helpers ──

    private String place(String method, int quantity) throws Exception {
        mvc.perform(put("/api/v1/cart/items/" + variant).with(csrf()).cookie(customer)
                .contentType(MediaType.APPLICATION_JSON).content("{\"quantity\":" + quantity + "}"))
                .andExpect(status().isOk());
        BigDecimal total = new BigDecimal("1000.00").multiply(BigDecimal.valueOf(quantity)).add(new BigDecimal("60.00"));
        return body(mvc.perform(jsonPost("/api/v1/orders", new PlaceOrderRequest("Test Customer", "01012345678", 1,
                "Nasr City", "12 Example Street", null, optionId, null, method, total, "key-" + UUID.randomUUID()))
                .cookie(customer)).andExpect(status().isCreated()).andReturn()).get("reference").asText();
    }

    private ResultActions move(String reference, String status, Cookie staff) throws Exception {
        return mvc.perform(jsonPost("/api/v1/admin/orders/" + reference + "/status", Map.of("status", status))
                .cookie(staff));
    }

    private ResultActions putSetting(String key, Map<String, Object> body, Cookie staff) throws Exception {
        return mvc.perform(put("/api/v1/admin/settings/" + key).with(csrf()).cookie(staff)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)));
    }

    private Map<String, Object> deliveryOption(String fee, boolean active, List<Map<String, Object>> governorates) {
        return Map.of("type", "STANDARD", "nameEn", "Standard", "nameAr", "عادي", "estimateEn", "2-4 days",
                "estimateAr", "٢-٤ أيام", "fee", new BigDecimal(fee), "active", active, "sortOrder", 1,
                "governorates", governorates);
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
