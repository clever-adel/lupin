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
import org.springframework.test.web.servlet.MvcResult;
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

/** Who may do what on the dashboard: owner, admin, customer, and a staff member who has been switched off. */
class StaffIT extends IntegrationTest {

    static final String STAFF_PASSWORD = "a-long-staff-password-1";

    @Autowired
    JdbcClient jdbc;

    Cookie owner;
    Cookie admin;
    Cookie customer;

    @BeforeEach
    void setUp() throws Exception {
        owner = ownerCookie();
        admin = staffCookie(Role.ADMIN);
        customer = cookie(register(uniqueEmail()), AuthCookies.ACCESS);
    }

    @Test
    void onlyTheOwnerManagesStaffAccounts() throws Exception {
        String email = uniqueEmail();
        Map<String, Object> newAdmin = Map.of("email", email, "fullName", "New Admin", "role", "ADMIN",
                "password", STAFF_PASSWORD);

        mvc.perform(jsonPost("/api/v1/admin/staff", newAdmin).cookie(admin)).andExpect(status().isForbidden());
        mvc.perform(jsonPost("/api/v1/admin/staff", newAdmin).cookie(customer)).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/admin/staff").cookie(admin)).andExpect(status().isForbidden());

        // Weak passwords and unknown roles are refused.
        mvc.perform(jsonPost("/api/v1/admin/staff", Map.of("email", uniqueEmail(), "fullName", "X Y", "role", "ADMIN",
                "password", "short")).cookie(owner)).andExpect(status().isBadRequest());
        mvc.perform(jsonPost("/api/v1/admin/staff", Map.of("email", uniqueEmail(), "fullName", "X Y", "role", "CUSTOMER",
                "password", STAFF_PASSWORD)).cookie(owner)).andExpect(status().isBadRequest());

        String id = body(mvc.perform(jsonPost("/api/v1/admin/staff", newAdmin).cookie(owner))
                .andExpect(status().isCreated()).andReturn()).get("id").asText();
        mvc.perform(jsonPost("/api/v1/admin/staff", newAdmin).cookie(owner))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EMAIL_TAKEN"));

        mvc.perform(get("/api/v1/admin/staff").cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + id + "')].role").value("ADMIN"))
                .andExpect(jsonPath("$[?(@.id=='" + id + "')].status").value("ACTIVE"))
                .andExpect(jsonPath("$[?(@.you==true)].role").value("OWNER"));

        // The new admin can work, but still cannot manage staff.
        Cookie fresh = cookie(login(email, STAFF_PASSWORD), AuthCookies.ACCESS);
        mvc.perform(get("/api/v1/admin/orders").cookie(fresh)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/admin/staff").cookie(fresh)).andExpect(status().isForbidden());

        long audits = jdbc.sql("select count(*) from audit_logs where action = 'STAFF_CREATE' and entity_id = :id")
                .param("id", id).query(Long.class).single();
        assertThat(audits).isEqualTo(1);
        String logged = jdbc.sql("select detail::text from audit_logs where action = 'STAFF_CREATE' and entity_id = :id")
                .param("id", id).query(String.class).single();
        assertThat(logged).doesNotContain(STAFF_PASSWORD);
    }

    @Test
    void aDisabledStaffMemberLosesAccessImmediatelyEvenWithAValidToken() throws Exception {
        String email = uniqueEmail();
        String id = body(mvc.perform(jsonPost("/api/v1/admin/staff", Map.of("email", email, "fullName", "Temp Admin",
                "role", "ADMIN", "password", STAFF_PASSWORD)).cookie(owner)).andExpect(status().isCreated())
                .andReturn()).get("id").asText();
        MvcResult signedIn = login(email, STAFF_PASSWORD);
        Cookie access = cookie(signedIn, AuthCookies.ACCESS);
        Cookie refresh = cookie(signedIn, AuthCookies.REFRESH);
        mvc.perform(get("/api/v1/admin/summary").cookie(access)).andExpect(status().isOk());

        mvc.perform(jsonPost("/api/v1/admin/staff/" + id + "/status", Map.of("status", "DISABLED")).cookie(owner))
                .andExpect(status().isNoContent());

        // Same, still unexpired, access token: refused. No new token either, and no new sign-in.
        mvc.perform(get("/api/v1/admin/summary").cookie(access)).andExpect(status().isUnauthorized());
        mvc.perform(jsonPost("/api/v1/auth/refresh", Map.of()).cookie(refresh)).andExpect(status().isUnauthorized());
        login(email, STAFF_PASSWORD);
        mvc.perform(jsonPost("/api/v1/auth/login", new LoginBody(email, STAFF_PASSWORD)))
                .andExpect(status().isUnauthorized());

        // Switched back on, they sign in again.
        mvc.perform(jsonPost("/api/v1/admin/staff/" + id + "/status", Map.of("status", "ACTIVE")).cookie(owner))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/admin/summary").cookie(cookie(login(email, STAFF_PASSWORD), AuthCookies.ACCESS)))
                .andExpect(status().isOk());
    }

    @Test
    void ownerCannotLockThemselvesOutAndCustomersAreNotManagedHere() throws Exception {
        String ownerId = "";
        for (JsonNode row : body(mvc.perform(get("/api/v1/admin/staff").cookie(owner)).andReturn())) {
            if (row.get("you").asBoolean()) {
                ownerId = row.get("id").asText();
            }
        }
        mvc.perform(jsonPost("/api/v1/admin/staff/" + ownerId + "/status", Map.of("status", "DISABLED")).cookie(owner))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("NOT_YOURSELF"));

        String customerEmail = uniqueEmail();
        register(customerEmail);
        String customerId = jdbc.sql("select id::text from users where email = :e").param("e", customerEmail)
                .query(String.class).single();
        mvc.perform(jsonPost("/api/v1/admin/staff/" + customerId + "/status", Map.of("status", "DISABLED")).cookie(owner))
                .andExpect(status().isNotFound());
        mvc.perform(jsonPost("/api/v1/admin/staff/" + customerId + "/password", Map.of("password", STAFF_PASSWORD))
                .cookie(owner)).andExpect(status().isNotFound());
    }

    @Test
    void passwordsCanBeChangedByTheirOwnerAndResetByTheStoreOwner() throws Exception {
        String email = uniqueEmail();
        String id = body(mvc.perform(jsonPost("/api/v1/admin/staff", Map.of("email", email, "fullName", "Key Admin",
                "role", "ADMIN", "password", STAFF_PASSWORD)).cookie(owner)).andExpect(status().isCreated())
                .andReturn()).get("id").asText();
        MvcResult signedIn = login(email, STAFF_PASSWORD);
        Cookie access = cookie(signedIn, AuthCookies.ACCESS);
        Cookie refresh = cookie(signedIn, AuthCookies.REFRESH);

        // Changing your own password needs the current one, and a strong new one for staff.
        mvc.perform(jsonPost("/api/v1/auth/password", Map.of("currentPassword", "not-my-password",
                "newPassword", "another-long-password-2")).cookie(access))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("WRONG_PASSWORD"));
        mvc.perform(jsonPost("/api/v1/auth/password", Map.of("currentPassword", STAFF_PASSWORD,
                "newPassword", "elevenchars")).cookie(access))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("WEAK_PASSWORD"));
        mvc.perform(jsonPost("/api/v1/auth/password", Map.of("currentPassword", STAFF_PASSWORD,
                "newPassword", STAFF_PASSWORD)).cookie(access))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("SAME_PASSWORD"));
        mvc.perform(jsonPost("/api/v1/auth/password", Map.of("currentPassword", STAFF_PASSWORD,
                "newPassword", "another-long-password-2"))).andExpect(status().isUnauthorized());

        mvc.perform(jsonPost("/api/v1/auth/password", Map.of("currentPassword", STAFF_PASSWORD,
                "newPassword", "another-long-password-2")).cookie(access)).andExpect(status().isNoContent());
        // Old sessions end; old password stops working; new one works.
        mvc.perform(jsonPost("/api/v1/auth/refresh", Map.of()).cookie(refresh)).andExpect(status().isUnauthorized());
        mvc.perform(jsonPost("/api/v1/auth/login", new LoginBody(email, STAFF_PASSWORD)))
                .andExpect(status().isUnauthorized());
        mvc.perform(jsonPost("/api/v1/auth/login", new LoginBody(email, "another-long-password-2")))
                .andExpect(status().isOk());

        // The owner resets it for someone who is locked out; an admin cannot reset anyone's.
        mvc.perform(jsonPost("/api/v1/admin/staff/" + id + "/password", Map.of("password", "reset-by-the-owner-3"))
                .cookie(admin)).andExpect(status().isForbidden());
        Cookie openDashboard = cookie(login(email, "another-long-password-2"), AuthCookies.ACCESS);
        mvc.perform(get("/api/v1/admin/summary").cookie(openDashboard)).andExpect(status().isOk());
        mvc.perform(jsonPost("/api/v1/admin/staff/" + id + "/password", Map.of("password", "reset-by-the-owner-3"))
                .cookie(owner)).andExpect(status().isNoContent());
        // A dashboard that was already open stops working at once, although its token has not expired.
        mvc.perform(get("/api/v1/admin/summary").cookie(openDashboard)).andExpect(status().isUnauthorized());
        mvc.perform(jsonPost("/api/v1/auth/login", new LoginBody(email, "reset-by-the-owner-3")))
                .andExpect(status().isOk());

        // Customers change theirs too (10 characters minimum).
        String customerEmail = uniqueEmail();
        Cookie shopper = cookie(register(customerEmail), AuthCookies.ACCESS);
        mvc.perform(jsonPost("/api/v1/auth/password", Map.of("currentPassword", PASSWORD_OK,
                "newPassword", "new-shopper-pw")).cookie(shopper)).andExpect(status().isNoContent());
        mvc.perform(jsonPost("/api/v1/auth/login", new LoginBody(customerEmail, "new-shopper-pw")))
                .andExpect(status().isOk());
    }

    @Test
    void everyStaffEndpointRefusesCustomersAndOwnerOnlyOnesRefuseAdmins() throws Exception {
        List<String> staffGets = List.of("/api/v1/admin/summary", "/api/v1/admin/orders", "/api/v1/admin/products",
                "/api/v1/admin/payments/transfers", "/api/v1/admin/delivery/options", "/api/v1/admin/settings",
                "/api/v1/admin/promotions", "/api/v1/admin/promotions/targets", "/api/v1/admin/policies",
                "/api/v1/admin/faq");
        for (String url : staffGets) {
            mvc.perform(get(url)).andExpect(status().isUnauthorized());
            mvc.perform(get(url).cookie(customer)).andExpect(status().isForbidden());
            mvc.perform(get(url).cookie(admin)).andExpect(status().isOk());
            mvc.perform(get(url).cookie(owner)).andExpect(status().isOk());
        }
        // Owner-only actions.
        mvc.perform(get("/api/v1/admin/staff").cookie(admin)).andExpect(status().isForbidden());
        mvc.perform(jsonPost("/api/v1/admin/policies/privacy/publish", Map.of()).cookie(admin))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/v1/admin/settings/payment_methods").with(csrf()).cookie(admin)
                .contentType(MediaType.APPLICATION_JSON).content("{\"COD\":true}")).andExpect(status().isForbidden());
        mvc.perform(put("/api/v1/admin/settings/checkout").with(csrf()).cookie(admin)
                .contentType(MediaType.APPLICATION_JSON).content("{\"cancelUndoMinutes\":20}"))
                .andExpect(status().isForbidden());
        mvc.perform(jsonPost("/api/v1/admin/orders/LP-0/refunded", Map.of()).cookie(admin))
                .andExpect(status().isForbidden());
    }

    @Test
    void ownerRecordsARefundForAPaidOrderThatWasCancelled() throws Exception {
        // A paid InstaPay order, cancelled by staff, is left waiting for a refund.
        mvc.perform(patch("/api/v1/admin/departments/men").with(csrf()).cookie(owner)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        String category = body(mvc.perform(jsonPost("/api/v1/admin/categories",
                new CategoryRequest("men", null, "Rfd " + UUID.randomUUID().toString().substring(0, 8), "فئة"))
                .cookie(owner)).andReturn()).get("slug").asText();
        jdbc.sql("update promotions set active = false").update();
        setting("checkout", "freeDeliveryThreshold", "null");
        setting("payment_methods", "INSTAPAY_MANUAL", "true");
        setting("payment_methods", "instapayHandle", "\"lupin.test@instapay\"");
        int option = jdbc.sql("insert into delivery_options (code, type, name_en, name_ar, fee, active)"
                + " values (:c, 'STANDARD', 'Standard', 'عادي', 60, true) returning id")
                .param("c", "rfd-" + UUID.randomUUID().toString().substring(0, 8)).query(Integer.class).single();
        JsonNode product = body(mvc.perform(jsonPost("/api/v1/admin/products", new ProductRequest("Refund Jacket",
                "منتج", "men", category, "", "", "", "", "", "", null, null, new BigDecimal("1000.00"), null, "ADULT",
                List.of("M"), List.of(new ColorRequest("Black", "أسود", "#0B0B0C", true, List.of())), 3)).cookie(owner))
                .andReturn());
        mvc.perform(patch("/api/v1/admin/products/" + product.get("id").asLong() + "/status").with(csrf())
                .cookie(owner).contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(put("/api/v1/cart/items/" + product.get("variantIds").get(0).asLong()).with(csrf())
                .cookie(customer).contentType(MediaType.APPLICATION_JSON).content("{\"quantity\":1}"))
                .andExpect(status().isOk());
        String reference = body(mvc.perform(jsonPost("/api/v1/orders", new PlaceOrderRequest("Test Customer",
                "01012345678", 1, "Nasr City", "12 Example Street", null, option, null, "INSTAPAY_MANUAL",
                new BigDecimal("1060.00"), "key-" + UUID.randomUUID())).cookie(customer))
                .andExpect(status().isCreated()).andReturn()).get("reference").asText();
        mvc.perform(jsonPost("/api/v1/orders/" + reference + "/payment/transfer", Map.of("reference", "IPN 7777"))
                .cookie(customer)).andExpect(status().isOk());
        String paymentId = jdbc.sql("select p.id::text from payments p join orders o on o.id = p.order_id"
                + " where o.reference = :r").param("r", reference).query(String.class).single();
        mvc.perform(jsonPost("/api/v1/admin/payments/" + paymentId + "/confirm", Map.of()).cookie(admin))
                .andExpect(status().isNoContent());

        // Not waiting for a refund yet.
        mvc.perform(jsonPost("/api/v1/admin/orders/" + reference + "/refunded", Map.of()).cookie(owner))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("NO_REFUND_DUE"));

        mvc.perform(jsonPost("/api/v1/admin/orders/" + reference + "/status", Map.of("status", "CANCELLED"))
                .cookie(admin)).andExpect(jsonPath("$.order.paymentStatus").value("REFUND_PENDING"));
        mvc.perform(jsonPost("/api/v1/admin/orders/" + reference + "/refunded", Map.of("note", "Sent back by InstaPay"))
                .cookie(admin)).andExpect(status().isForbidden());
        mvc.perform(jsonPost("/api/v1/admin/orders/" + reference + "/refunded", Map.of("note", "Sent back by InstaPay"))
                .cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.order.paymentStatus").value("REFUNDED"))
                .andExpect(jsonPath("$.payments[0].status").value("REFUNDED"));
        mvc.perform(jsonPost("/api/v1/admin/orders/" + reference + "/refunded", Map.of()).cookie(owner))
                .andExpect(status().isConflict());

        BigDecimal refunded = jdbc.sql("select sum(amount) from refunds where payment_id = cast(:p as uuid)")
                .param("p", paymentId).query(BigDecimal.class).single();
        assertThat(refunded).isEqualByComparingTo("1060.00");
        mvc.perform(get("/api/v1/orders/" + reference).cookie(customer))
                .andExpect(jsonPath("$.paymentStatus").value("REFUNDED"));
    }

    private void setting(String key, String field, String jsonValue) {
        jdbc.sql("update site_settings set value = jsonb_set(value, cast(:path as text[]), cast(:v as jsonb)) where key = :k")
                .param("path", "{" + field + "}").param("v", jsonValue).param("k", key).update();
    }
}
