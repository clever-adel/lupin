package store.lupinwear.look;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class LookIT extends IntegrationTest {

    private static final String PHOTO = "/media/0b8a2c1e-3f4d-4a5b-8c6d-7e8f9a0b1c2d.jpg";

    Cookie owner;
    String tops;
    String bottoms;
    String shoes;

    @BeforeEach
    void setUp() throws Exception {
        owner = ownerCookie();
        mvc.perform(patch("/api/v1/admin/departments/men").with(csrf()).cookie(owner)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        tops = category("Tops");
        bottoms = category("Bottoms");
        shoes = category("Shoes");
    }

    @Test
    void aLookIsHiddenUntilItHasAPhotoAndIsPublishedThenShowsLivePricesAndStock() throws Exception {
        JsonNode shirt = product("Look Shirt", tops, "1200.00", "900.00", 2);
        JsonNode trousers = product("Look Trousers", bottoms, "1500.00", null, 0);
        JsonNode draft = product("Look Draft Belt", shoes, "300.00", null, 3);
        publish(shirt.get("id").asLong());
        publish(trousers.get("id").asLong());
        long shirtBlack = colorId(shirt, 0);

        JsonNode look = body(mvc.perform(jsonPost("/api/v1/admin/looks", lookRequest("Evening Edit", List.of(
                        item(shirt, 0, "TOP"), item(trousers, 0, "BOTTOM"), item(draft, 0, "ACCESSORY")))).cookie(owner))
                .andExpect(status().isCreated()).andReturn());
        long id = look.get("id").asLong();
        String slug = look.get("slug").asText();
        assertThat(slug).startsWith("evening-edit");

        // No photo yet: cannot be published, and shoppers cannot see it.
        setStatus(id, "PUBLISHED").andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("LOOK_NO_PHOTO"));
        mvc.perform(get("/api/v1/catalog/looks/" + slug)).andExpect(status().isNotFound());

        mvc.perform(put("/api/v1/admin/looks/" + id + "/image").with(csrf()).cookie(owner)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("publicId", PHOTO.substring(7), "url", PHOTO, "source", "AI"))))
                .andExpect(status().isNoContent());
        setStatus(id, "PUBLISHED").andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/catalog/looks/" + slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.imageUrl").value(PHOTO))
                .andExpect(jsonPath("$.aiGenerated").value(true))
                // The draft product is not shown to shoppers.
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].productSlug").value(shirt.get("slug").asText()))
                .andExpect(jsonPath("$.items[0].role").value("TOP"))
                .andExpect(jsonPath("$.items[0].colorId").value(shirtBlack))
                .andExpect(jsonPath("$.items[0].inStock").value(true))
                .andExpect(jsonPath("$.items[0].colors.length()").value(2))
                .andExpect(jsonPath("$.items[0].colors[0].variants[0].sizeCode").value("S"))
                .andExpect(jsonPath("$.items[0].colors[0].variants[0].maxQuantity").value(2))
                .andExpect(jsonPath("$.items[1].inStock").value(false))
                // Today's prices: 900 (on sale) + 1500.
                .andExpect(jsonPath("$.total").value(2400.00))
                .andExpect(jsonPath("$.fullPrice").value(2700.00));

        mvc.perform(get("/api/v1/catalog/looks"))
                .andExpect(jsonPath("$[?(@.slug=='" + slug + "')].itemCount").value(2));
        mvc.perform(get("/api/v1/catalog/looks").param("product", shirt.get("slug").asText()))
                .andExpect(jsonPath("$[0].slug").value(slug));

        // Changing what the model wears removes the photo and takes the look off the store.
        mvc.perform(put("/api/v1/admin/looks/" + id).with(csrf()).cookie(owner).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(lookRequest("Evening Edit", List.of(item(shirt, 1, "TOP"))))))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/admin/looks/" + id).cookie(owner))
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.imageUrl").doesNotExist())
                .andExpect(jsonPath("$.items.length()").value(1));
        mvc.perform(get("/api/v1/catalog/looks/" + slug)).andExpect(status().isNotFound());
    }

    @Test
    void suggestsInStockProductsFromOtherCategories() throws Exception {
        JsonNode shirt = product("Pair Shirt", tops, "1000.00", null, 3);
        JsonNode sneaker = product("Pair Sneaker", shoes, "2000.00", null, 3);
        JsonNode soldOut = product("Pair Sold Out", bottoms, "800.00", null, 0);
        JsonNode sameCategory = product("Pair Other Shirt", tops, "700.00", null, 3);
        for (JsonNode p : List.of(shirt, sneaker, soldOut, sameCategory)) {
            publish(p.get("id").asLong());
        }
        String slug = publishedLook("Pairing Test", List.of(item(shirt, 0, "TOP")));

        MvcResult result = mvc.perform(get("/api/v1/catalog/looks/" + slug)).andExpect(status().isOk()).andReturn();
        List<String> pairs = body(result).get("pairsWith").findValuesAsText("slug");
        assertThat(pairs).contains(sneaker.get("slug").asText())
                .doesNotContain(soldOut.get("slug").asText(), sameCategory.get("slug").asText(), shirt.get("slug").asText());
    }

    @Test
    void staffInputIsChecked() throws Exception {
        JsonNode shirt = product("Check Shirt", tops, "1000.00", null, 1);
        JsonNode other = product("Check Other", bottoms, "1000.00", null, 1);
        long otherColour = colorId(other, 0);

        // A colour from another product.
        mvc.perform(jsonPost("/api/v1/admin/looks", lookRequest("Bad Colour", List.of(
                        Map.of("productId", shirt.get("id").asLong(), "colorId", otherColour, "role", "TOP")))).cookie(owner))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_ITEM"));
        // The same product twice.
        mvc.perform(jsonPost("/api/v1/admin/looks", lookRequest("Twice", List.of(item(shirt, 0, "TOP"), item(shirt, 1, "OUTER"))))
                        .cookie(owner))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("DUPLICATE_PRODUCT"));

        long id = body(mvc.perform(jsonPost("/api/v1/admin/looks", lookRequest("Checked", List.of(item(shirt, 0, "TOP"))))
                .cookie(owner)).andExpect(status().isCreated()).andReturn()).get("id").asLong();
        // Only our own uploads can be the photo.
        mvc.perform(put("/api/v1/admin/looks/" + id + "/image").with(csrf()).cookie(owner)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("publicId", "x", "url", "https://evil.example/x.jpg", "source", "PHOTO"))))
                .andExpect(status().isBadRequest());
        // No AI account in tests: generating says so instead of failing later.
        mvc.perform(jsonPost("/api/v1/admin/looks/" + id + "/generations", Map.of()).cookie(owner))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("AI_NOT_CONFIGURED"));
        mvc.perform(get("/api/v1/admin/looks/ai").cookie(owner)).andExpect(jsonPath("$.available").value(false));

        // Shoppers and signed-out visitors cannot reach the staff endpoints.
        mvc.perform(get("/api/v1/admin/looks")).andExpect(status().isUnauthorized());
        mvc.perform(jsonPost("/api/v1/admin/looks", lookRequest("Nope", List.of(item(shirt, 0, "TOP")))))
                .andExpect(status().isUnauthorized());
    }

    // ── helpers ──

    private String publishedLook(String title, List<Map<String, Object>> items) throws Exception {
        JsonNode look = body(mvc.perform(jsonPost("/api/v1/admin/looks", lookRequest(title, items)).cookie(owner))
                .andExpect(status().isCreated()).andReturn());
        long id = look.get("id").asLong();
        mvc.perform(put("/api/v1/admin/looks/" + id + "/image").with(csrf()).cookie(owner)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("publicId", PHOTO.substring(7), "url", PHOTO, "source", "PHOTO"))))
                .andExpect(status().isNoContent());
        setStatus(id, "PUBLISHED").andExpect(status().isNoContent());
        return look.get("slug").asText();
    }

    private org.springframework.test.web.servlet.ResultActions setStatus(long id, String status) throws Exception {
        return mvc.perform(patch("/api/v1/admin/looks/" + id + "/status").with(csrf()).cookie(owner)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"" + status + "\"}"));
    }

    private static Map<String, Object> lookRequest(String title, List<Map<String, Object>> items) {
        return Map.of("titleEn", title + " " + UUID.randomUUID().toString().substring(0, 6), "titleAr", "إطلالة",
                "descriptionEn", "", "descriptionAr", "", "sortOrder", 0, "items", items);
    }

    private Map<String, Object> item(JsonNode product, int colour, String role) throws Exception {
        return Map.of("productId", product.get("id").asLong(), "colorId", colorId(product, colour), "role", role);
    }

    private long colorId(JsonNode product, int index) throws Exception {
        JsonNode detail = body(mvc.perform(get("/api/v1/admin/products/" + product.get("id").asLong()).cookie(owner))
                .andExpect(status().isOk()).andReturn());
        return detail.get("colors").get(index).get("id").asLong();
    }

    private String category(String name) throws Exception {
        MvcResult created = mvc.perform(jsonPost("/api/v1/admin/categories",
                        new CategoryRequest("men", null, name + " " + UUID.randomUUID().toString().substring(0, 8), "فئة"))
                        .cookie(owner))
                .andExpect(status().isCreated()).andReturn();
        return body(created).get("slug").asText();
    }

    private JsonNode product(String name, String category, String price, String salePrice, int stock) throws Exception {
        List<ImageRequest> photos = List.of(new ImageRequest("lupin/test/a", "https://res.cloudinary.com/demo/a.jpg", "Front", "أمام"));
        ProductRequest request = new ProductRequest(name + " " + UUID.randomUUID().toString().substring(0, 6), "منتج",
                "men", category, "Description", "وصف", "Cotton", "قطن", "Regular", "عادي", null, null,
                new BigDecimal(price), salePrice == null ? null : new BigDecimal(salePrice), "ADULT", List.of("S", "M"),
                List.of(new ColorRequest("Black", "أسود", "#0B0B0C", true, photos),
                        new ColorRequest("Sand", "رملي", "#C8B89A", false, List.of())),
                stock);
        return body(mvc.perform(jsonPost("/api/v1/admin/products", request).cookie(owner))
                .andExpect(status().isCreated()).andReturn());
    }

    private void publish(long id) throws Exception {
        mvc.perform(patch("/api/v1/admin/products/" + id + "/status").with(csrf()).cookie(owner)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
    }
}
