package store.lupinwear.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import store.lupinwear.catalog.api.CatalogDtos.CategoryRequest;
import store.lupinwear.catalog.api.CatalogDtos.ColorRequest;
import store.lupinwear.catalog.api.CatalogDtos.ImageRequest;
import store.lupinwear.catalog.api.CatalogDtos.ProductRequest;
import store.lupinwear.support.IntegrationTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class CatalogIT extends IntegrationTest {

    @Autowired
    JdbcClient jdbc;

    Cookie owner;
    String category;

    @BeforeEach
    void setUp() throws Exception {
        owner = ownerCookie();
        setDepartment("men", "ACTIVE");
        String name = "Cat " + UUID.randomUUID().toString().substring(0, 8);
        MvcResult created = mvc.perform(jsonPost("/api/v1/admin/categories",
                        new CategoryRequest("men", null, name, "فئة")).cookie(owner))
                .andExpect(status().isCreated()).andReturn();
        category = body(created).get("slug").asText();
    }

    @Test
    void draftIsHiddenUntilPublishedThenListedWithColoursAndStock() throws Exception {
        JsonNode created = create(request("Night Bomber", "2750.00", "2200.00", 3));
        String slug = created.get("slug").asText();
        long id = created.get("id").asLong();
        assertThat(created.get("variantIds")).hasSize(6); // 2 colours × 3 sizes

        mvc.perform(get("/api/v1/catalog/products/" + slug)).andExpect(status().isNotFound());

        publish(id);
        mvc.perform(get("/api/v1/catalog/products").param("department", "men").param("category", category))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].slug").value(slug))
                .andExpect(jsonPath("$.items[0].price").value(2750.00))
                .andExpect(jsonPath("$.items[0].salePrice").value(2200.00))
                .andExpect(jsonPath("$.items[0].discountPercent").value(20))
                .andExpect(jsonPath("$.items[0].inStock").value(true))
                .andExpect(jsonPath("$.items[0].colors.length()").value(2))
                .andExpect(jsonPath("$.items[0].colors[0].nameEn").value("Black"));

        mvc.perform(get("/api/v1/catalog/products/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.colors[0].main").value(true))
                .andExpect(jsonPath("$.colors[0].images.length()").value(2))
                .andExpect(jsonPath("$.colors[0].variants.length()").value(3))
                .andExpect(jsonPath("$.colors[0].variants[0].sizeCode").value("S"))
                .andExpect(jsonPath("$.colors[0].variants[0].available").value(true))
                .andExpect(jsonPath("$.colors[0].variants[0].maxQuantity").value(3))
                .andExpect(jsonPath("$.category.slug").value(category));
    }

    @Test
    void hidingTheDepartmentHidesItsProducts() throws Exception {
        JsonNode created = create(request("Hidden Dept Jacket", "1000.00", null, 1));
        publish(created.get("id").asLong());
        setDepartment("men", "COMING_SOON");

        mvc.perform(get("/api/v1/catalog/products/" + created.get("slug").asText())).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/catalog/departments"))
                .andExpect(jsonPath("$[?(@.slug=='men')].status").value("COMING_SOON"))
                .andExpect(jsonPath("$[?(@.slug=='men')].productCount").value(0));
    }

    @Test
    void filtersBySaleSizeStockPriceAndSearch() throws Exception {
        long onSale = create(request("Filter Alpha", "2000.00", "1500.00", 2)).get("id").asLong();
        long fullPrice = create(request("Filter Beta", "3000.00", null, 0)).get("id").asLong();
        publish(onSale);
        publish(fullPrice);

        assertThat(total("sale", "true")).isEqualTo(1);
        assertThat(total("inStock", "true")).isEqualTo(1);
        assertThat(total("size", "M")).isEqualTo(1);         // only products with M actually in stock
        assertThat(total("minPrice", "2500")).isEqualTo(1);
        assertThat(total("maxPrice", "1600")).isEqualTo(1);
        assertThat(total("q", "beta")).isEqualTo(1);
        assertThat(total("q", "100%")).isZero();              // wildcards are escaped, not interpreted
        assertThat(total("color", "navy")).isEqualTo(2);

        MvcResult sorted = mvc.perform(get("/api/v1/catalog/products").param("category", category)
                .param("sort", "price_desc")).andReturn();
        assertThat(body(sorted).get("items").get(0).get("nameEn").asText()).isEqualTo("Filter Beta");
    }

    @Test
    void soldOutVariantIsReportedUnavailable() throws Exception {
        JsonNode created = create(request("Sold Out Size", "900.00", null, 1));
        publish(created.get("id").asLong());
        long variant = created.get("variantIds").get(0).asLong();

        mvc.perform(jsonPost("/api/v1/admin/inventory/" + variant + "/adjust", Map.of("delta", -1)).cookie(owner))
                .andExpect(status().isOk()).andExpect(jsonPath("$.available").value(0));
        mvc.perform(get("/api/v1/catalog/products/" + created.get("slug").asText()))
                .andExpect(jsonPath("$.colors[0].variants[0].available").value(false))
                .andExpect(jsonPath("$.colors[0].variants[0].maxQuantity").value(0))
                .andExpect(jsonPath("$.colors[0].variants[1].available").value(true));
    }

    @Test
    void variantLookupReturnsServerPriceAndOmitsUnpublished() throws Exception {
        JsonNode live = create(request("Lookup Live", "2000.00", "1500.00", 30));
        JsonNode draft = create(request("Lookup Draft", "999.00", null, 5));
        publish(live.get("id").asLong());
        long liveVariant = live.get("variantIds").get(1).asLong();
        long draftVariant = draft.get("variantIds").get(0).asLong();

        mvc.perform(get("/api/v1/catalog/variants").param("ids", liveVariant + "," + draftVariant + ",999999999"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].variantId").value(liveVariant))
                .andExpect(jsonPath("$[0].unitPrice").value(1500.00))
                .andExpect(jsonPath("$[0].sizeCode").value("M"))
                .andExpect(jsonPath("$[0].colorEn").value("Black"))
                .andExpect(jsonPath("$[0].maxQuantity").value(10)); // capped: exact stock is not revealed
    }

    @Test
    void stockCannotGoBelowReservedOrBelowZero() throws Exception {
        JsonNode created = create(request("Reserved Stock", "900.00", null, 5));
        long variant = created.get("variantIds").get(0).asLong();
        jdbc.sql("update inventory set reserved = 4 where variant_id = :v").param("v", variant).update();

        mvc.perform(jsonPost("/api/v1/admin/inventory/" + variant + "/adjust", Map.of("delta", -2)).cookie(owner))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("STOCK_BELOW_RESERVED"));
        mvc.perform(jsonPost("/api/v1/admin/inventory/" + variant + "/adjust", Map.of("delta", -1)).cookie(owner))
                .andExpect(status().isOk()).andExpect(jsonPath("$.onHand").value(4));

        long movements = jdbc.sql("select count(*) from inventory_movements where variant_id = :v")
                .param("v", variant).query(Long.class).single();
        assertThat(movements).isEqualTo(2); // initial receive + one accepted adjustment
    }

    @Test
    void invalidProductsAreRejected() throws Exception {
        mvc.perform(jsonPost("/api/v1/admin/products", request("Bad Sale", "1000.00", "1000.00", 1)).cookie(owner))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("SALE_PRICE_TOO_HIGH"));

        List<ImageRequest> eleven = new ArrayList<>();
        for (int i = 0; i < 11; i++) {
            eleven.add(new ImageRequest("lupin/test/" + i, "https://res.cloudinary.com/demo/" + i + ".jpg", "", ""));
        }
        ProductRequest tooManyPhotos = new ProductRequest("Too Many Photos", "صور كثيرة", "men", category, "", "", "",
                "", "", "", null, null, new BigDecimal("1000.00"), null, "ADULT", List.of("M"),
                List.of(new ColorRequest("Black", "أسود", "#0B0B0C", true, eleven)), 1);
        mvc.perform(jsonPost("/api/v1/admin/products", tooManyPhotos).cookie(owner))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        ProductRequest noMain = new ProductRequest("No Main", "بدون", "men", category, "", "", "", "", "", "", null,
                null, new BigDecimal("1000.00"), null, "ADULT", List.of("M"),
                List.of(new ColorRequest("Black", "أسود", "#0B0B0C", false, List.of())), 1);
        mvc.perform(jsonPost("/api/v1/admin/products", noMain).cookie(owner))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("MAIN_COLOUR_REQUIRED"));
    }

    @Test
    void sameNameGetsAUniqueSlugAndWritesAnAuditRow() throws Exception {
        String a = create(request("Twin Jacket", "1000.00", null, 1)).get("slug").asText();
        String b = create(request("Twin Jacket", "1000.00", null, 1)).get("slug").asText();
        assertThat(a).isNotEqualTo(b);
        long audits = jdbc.sql("select count(*) from audit_logs where action = 'PRODUCT_CREATE' and detail->>'slug' in (:a, :b)")
                .param("a", a).param("b", b).query(Long.class).single();
        assertThat(audits).isEqualTo(2);
    }

    private ProductRequest request(String name, String price, String salePrice, int stock) {
        List<ImageRequest> photos = List.of(
                new ImageRequest("lupin/test/a", "https://res.cloudinary.com/demo/a.jpg", "Front", "أمام"),
                new ImageRequest("lupin/test/b", "https://res.cloudinary.com/demo/b.jpg", "Back", "خلف"));
        return new ProductRequest(name, "منتج تجريبي", "men", category, "Description", "وصف", "Nylon", "نايلون",
                "Regular", "عادي", null, null, new BigDecimal(price), salePrice == null ? null : new BigDecimal(salePrice),
                "ADULT", List.of("S", "M", "L"),
                List.of(new ColorRequest("Black", "أسود", "#0B0B0C", true, photos),
                        new ColorRequest("Navy", "كحلي", "#16213A", false, List.of())),
                stock);
    }

    private JsonNode create(ProductRequest request) throws Exception {
        return body(mvc.perform(jsonPost("/api/v1/admin/products", request).cookie(owner))
                .andExpect(status().isCreated()).andReturn());
    }

    private void publish(long id) throws Exception {
        mvc.perform(patch("/api/v1/admin/products/" + id + "/status").with(csrf()).cookie(owner)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
    }

    private void setDepartment(String slug, String status) throws Exception {
        mvc.perform(patch("/api/v1/admin/departments/" + slug).with(csrf()).cookie(owner)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"" + status + "\"}"))
                .andExpect(status().isNoContent());
    }

    private long total(String param, String value) throws Exception {
        MvcResult result = mvc.perform(get("/api/v1/catalog/products").param("category", category).param(param, value))
                .andExpect(status().isOk()).andReturn();
        return body(result).get("total").asLong();
    }
}
