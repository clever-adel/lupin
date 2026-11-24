package store.lupinwear.shop;

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
import store.lupinwear.auth.domain.Role;
import store.lupinwear.catalog.api.CatalogDtos.CategoryRequest;
import store.lupinwear.catalog.api.CatalogDtos.ColorRequest;
import store.lupinwear.catalog.api.CatalogDtos.ProductRequest;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.support.IntegrationTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The shop counter: sales at the shop's own price take stock, returns put it back, never past what was sold. */
class ShopIT extends IntegrationTest {

    @Autowired
    JdbcClient jdbc;

    Cookie owner;
    Cookie admin;
    String name;
    long variant;

    @BeforeEach
    void setUp() throws Exception {
        owner = ownerCookie();
        admin = staffCookie(Role.ADMIN);
        mvc.perform(patch("/api/v1/admin/departments/men").with(csrf()).cookie(owner)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        String category = body(mvc.perform(jsonPost("/api/v1/admin/categories",
                new CategoryRequest("men", null, "Shop " + UUID.randomUUID().toString().substring(0, 8), "فئة"))
                .cookie(owner)).andExpect(status().isCreated()).andReturn()).get("slug").asText();
        name = "Shop Tee " + UUID.randomUUID().toString().substring(0, 6);
        ProductRequest product = new ProductRequest(name, "تيشيرت", "men", category, "", "", "", "", "", "", null, null,
                new BigDecimal("800.00"), null, "ADULT", List.of("M"),
                List.of(new ColorRequest("White", "أبيض", "#FFFFFF", true, List.of())), 5);
        JsonNode created = body(mvc.perform(jsonPost("/api/v1/admin/products", product).cookie(owner))
                .andExpect(status().isCreated()).andReturn());
        variant = created.get("variantIds").get(0).asLong();
    }

    @Test
    void saleAtTheShopPriceTakesStockAndAReturnPutsItBack() throws Exception {
        // The piece is there to pick, with the online price as a hint.
        JsonNode pieces = body(mvc.perform(get("/api/v1/admin/shop/pieces").param("q", name).cookie(admin))
                .andExpect(status().isOk()).andReturn());
        assertThat(pieces.size()).isEqualTo(1);
        assertThat(pieces.get(0).get("available").asInt()).isEqualTo(5);
        assertThat(pieces.get(0).get("onlinePrice").decimalValue()).isEqualByComparingTo("800.00");

        JsonNode sale = body(mvc.perform(jsonPost("/api/v1/admin/shop/sales", Map.of("paymentMethod", "CASH",
                "items", List.of(Map.of("variantId", variant, "quantity", 3, "unitPrice", "650.00")))).cookie(admin))
                .andExpect(status().isCreated()).andReturn());
        assertThat(sale.get("total").decimalValue()).isEqualByComparingTo("1950.00");
        assertThat(onHand()).isEqualTo(2);

        // Cannot sell more than is left.
        mvc.perform(jsonPost("/api/v1/admin/shop/sales", Map.of(
                "items", List.of(Map.of("variantId", variant, "quantity", 3, "unitPrice", "650.00")))).cookie(admin))
                .andExpect(status().isConflict());
        assertThat(onHand()).isEqualTo(2);

        long saleId = sale.get("id").asLong();
        long line = sale.get("items").get(0).get("id").asLong();
        JsonNode back = body(mvc.perform(jsonPost("/api/v1/admin/shop/returns", Map.of("originalSaleId", saleId,
                "items", List.of(Map.of("originalItemId", line, "quantity", 2, "unitPrice", "650.00")))).cookie(admin))
                .andExpect(status().isCreated()).andReturn());
        assertThat(back.get("kind").asText()).isEqualTo("RETURN");
        assertThat(onHand()).isEqualTo(4);

        // Only one of the three is still out there.
        mvc.perform(jsonPost("/api/v1/admin/shop/returns", Map.of("originalSaleId", saleId,
                "items", List.of(Map.of("originalItemId", line, "quantity", 2, "unitPrice", "650.00")))).cookie(admin))
                .andExpect(status().isConflict());
        assertThat(onHand()).isEqualTo(4);

        JsonNode receipt = body(mvc.perform(get("/api/v1/admin/shop/sales/" + saleId).cookie(admin))
                .andExpect(status().isOk()).andReturn());
        assertThat(receipt.get("items").get(0).get("returned").asInt()).isEqualTo(2);
        assertThat(receipt.get("returnIds").size()).isEqualTo(1);

        // A piece sold before the shop was on the dashboard can still come back by naming it.
        mvc.perform(jsonPost("/api/v1/admin/shop/returns", Map.of(
                "items", List.of(Map.of("variantId", variant, "quantity", 1, "unitPrice", "500.00")))).cookie(admin))
                .andExpect(status().isCreated());
        assertThat(onHand()).isEqualTo(5);

        JsonNode summary = body(mvc.perform(get("/api/v1/admin/shop/summary").cookie(admin))
                .andExpect(status().isOk()).andReturn());
        assertThat(summary.get("today").get("sales").decimalValue()).isGreaterThanOrEqualTo(new BigDecimal("1950.00"));
        assertThat(summary.get("today").get("returns").decimalValue()).isGreaterThanOrEqualTo(new BigDecimal("1800.00"));
    }

    @Test
    void customersCannotUseTheShopCounter() throws Exception {
        Cookie customer = cookie(register(uniqueEmail()), AuthCookies.ACCESS);
        mvc.perform(get("/api/v1/admin/shop/pieces")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/admin/shop/pieces").cookie(customer)).andExpect(status().isForbidden());
        mvc.perform(jsonPost("/api/v1/admin/shop/sales", Map.of(
                "items", List.of(Map.of("variantId", variant, "quantity", 1, "unitPrice", "1.00")))).cookie(customer))
                .andExpect(status().isForbidden());
        assertThat(onHand()).isEqualTo(5);
    }

    private int onHand() {
        return jdbc.sql("select on_hand from inventory where variant_id = :v").param("v", variant)
                .query(Integer.class).single();
    }
}
