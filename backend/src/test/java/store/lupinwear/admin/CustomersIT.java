package store.lupinwear.admin;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.Cookie;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import store.lupinwear.auth.domain.Role;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.support.IntegrationTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The customers page: who signed up, what they bought, and that staff and outsiders are kept out. */
class CustomersIT extends IntegrationTest {

    @Autowired
    JdbcClient jdbc;

    @Test
    void staffSeeEveryCustomerWithTheirOrdersAndSpend() throws Exception {
        Cookie admin = staffCookie(Role.ADMIN);
        String email = uniqueEmail();
        Cookie customer = cookie(register(email), AuthCookies.ACCESS);
        UUID id = jdbc.sql("select id from users where email = :e").param("e", email).query(UUID.class).single();
        order(id, "PAID", "690.00");
        order(id, "DELIVERED", "900.00");
        order(id, "CANCELLED", "500.00");

        // Outsiders and customers are refused.
        mvc.perform(get("/api/v1/admin/customers")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/admin/customers").cookie(customer)).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/admin/customers/summary").cookie(customer)).andExpect(status().isForbidden());

        JsonNode found = body(mvc.perform(get("/api/v1/admin/customers").param("q", email).cookie(admin))
                .andExpect(status().isOk()).andReturn());
        assertThat(found.get("total").asLong()).isEqualTo(1);
        JsonNode row = found.get("items").get(0);
        assertThat(row.get("email").asText()).isEqualTo(email);
        assertThat(row.get("fullName").asText()).isEqualTo("Test Customer");
        assertThat(row.get("orders").asInt()).isEqualTo(3);
        // Cancelled orders are not money in.
        assertThat(row.get("spent").decimalValue()).isEqualByComparingTo("1590.00");
        assertThat(row.get("phone").asText()).isEqualTo("01011112222");
        assertThat(row.get("governorate").asText()).isEqualTo("Cairo");
        assertThat(row.get("signUp").asText()).isEqualTo("EMAIL");

        // Searching by the phone on their orders finds them too.
        JsonNode byPhone = body(mvc.perform(get("/api/v1/admin/customers").param("q", "01011112222").cookie(admin))
                .andExpect(status().isOk()).andReturn());
        assertThat(byPhone.get("items").findValuesAsText("email")).contains(email);

        // A "%" in the search is a character, not a wildcard.
        JsonNode none = body(mvc.perform(get("/api/v1/admin/customers").param("q", "%").cookie(admin))
                .andExpect(status().isOk()).andReturn());
        assertThat(none.get("total").asLong()).isZero();

        JsonNode top = body(mvc.perform(get("/api/v1/admin/customers").param("sort", "spent").cookie(admin))
                .andExpect(status().isOk()).andReturn());
        assertThat(top.get("items").get(0).get("spent").decimalValue()).isGreaterThanOrEqualTo(row.get("spent").decimalValue());

        JsonNode summary = body(mvc.perform(get("/api/v1/admin/customers/summary").cookie(admin))
                .andExpect(status().isOk()).andReturn());
        assertThat(summary.get("customers").asLong()).isPositive();
        assertThat(summary.get("withOrders").asLong()).isPositive();
    }

    @Test
    void staffAccountsAreNotListedAsCustomers() throws Exception {
        Cookie owner = ownerCookie();
        String staffEmail = uniqueEmail();
        authService.createStaff(staffEmail, "staff-" + PASSWORD_OK, "Hidden Staff", Role.ADMIN);

        JsonNode found = body(mvc.perform(get("/api/v1/admin/customers").param("q", staffEmail).cookie(owner))
                .andExpect(status().isOk()).andReturn());
        assertThat(found.get("total").asLong()).isZero();
    }

    private void order(UUID user, String status, String total) {
        jdbc.sql("""
                insert into orders (reference, user_id, status, payment_status, subtotal, total, customer_name,
                    customer_phone, governorate_id, governorate_name, city, address_line, delivery_option_name)
                values (:ref, :user, :status, 'PAID', :total, :total, 'Test Customer', '01011112222', 1, 'Cairo',
                    'Nasr City', '12 Example Street', 'Standard')
                """)
                .param("ref", "LT-" + UUID.randomUUID().toString().substring(0, 8))
                .param("user", user).param("status", status).param("total", new java.math.BigDecimal(total))
                .update();
    }
}
