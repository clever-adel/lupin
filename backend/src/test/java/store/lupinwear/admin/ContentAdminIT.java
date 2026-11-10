package store.lupinwear.admin;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
import java.util.HashMap;
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
import store.lupinwear.security.AuthCookies;
import store.lupinwear.support.IntegrationTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Product editing, offers, policies and questions as staff manage them, and what customers then see. */
class ContentAdminIT extends IntegrationTest {

    @Autowired
    JdbcClient jdbc;

    Cookie owner;
    Cookie admin;
    Cookie customer;
    String category;
    long categoryId;
    long productId;
    String productSlug;
    long variant;

    @BeforeEach
    void setUp() throws Exception {
        owner = ownerCookie();
        admin = staffCookie(Role.ADMIN);
        customer = cookie(register(uniqueEmail()), AuthCookies.ACCESS);
        mvc.perform(patch("/api/v1/admin/departments/men").with(csrf()).cookie(owner)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
        category = body(mvc.perform(jsonPost("/api/v1/admin/categories",
                new CategoryRequest("men", null, "Cnt " + UUID.randomUUID().toString().substring(0, 8), "فئة"))
                .cookie(owner)).andExpect(status().isCreated()).andReturn()).get("slug").asText();
        categoryId = jdbc.sql("select id from categories where slug = :s").param("s", category).query(Long.class).single();
        jdbc.sql("update promotions set active = false").update();

        ProductRequest product = new ProductRequest("Content Jacket " + UUID.randomUUID().toString().substring(0, 6),
                "منتج", "men", category, "", "", "", "", "", "", null, null, new BigDecimal("1000.00"), null,
                "ADULT", List.of("M"), List.of(new ColorRequest("Black", "أسود", "#0B0B0C", true, List.of())), 5);
        JsonNode created = body(mvc.perform(jsonPost("/api/v1/admin/products", product).cookie(owner))
                .andExpect(status().isCreated()).andReturn());
        productId = created.get("id").asLong();
        productSlug = created.get("slug").asText();
        variant = created.get("variantIds").get(0).asLong();
        mvc.perform(patch("/api/v1/admin/products/" + productId + "/status").with(csrf()).cookie(owner)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isNoContent());
    }

    @Test
    void productEditsReachTheStorefront() throws Exception {
        mvc.perform(get("/api/v1/admin/products/" + productId).cookie(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.categorySlug").value(category))
                .andExpect(jsonPath("$.price").value(1000.00));

        putJson("/api/v1/admin/products/" + productId, productUpdate("1200.00", "1200.00"), admin)
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("SALE_PRICE_TOO_HIGH"));
        putJson("/api/v1/admin/products/" + productId, productUpdate("1200.00", "900.00"), customer)
                .andExpect(status().isForbidden());
        putJson("/api/v1/admin/products/" + productId, productUpdate("1200.00", "900.00"), admin)
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/catalog/products/" + productSlug))
                .andExpect(jsonPath("$.nameEn").value("Renamed Jacket"))
                .andExpect(jsonPath("$.price").value(1200.00))
                .andExpect(jsonPath("$.salePrice").value(900.00))
                .andExpect(jsonPath("$.badge").value("NEW"))
                .andExpect(jsonPath("$.descriptionEn").value("Warm and light."));
    }

    @Test
    void offersCreatedByStaffApplyAtCheckout() throws Exception {
        mvc.perform(get("/api/v1/admin/promotions/targets").cookie(admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.categories[?(@.id==" + categoryId + ")]").exists());

        // 10% off this category, automatically.
        long automatic = body(mvc.perform(jsonPost("/api/v1/admin/promotions",
                promotion("Season offer", true, "PERCENT", "10", null, true)).cookie(admin))
                .andExpect(status().isCreated()).andReturn()).get("id").asLong();
        // A code worth 300.
        String code = "STAFF" + UUID.randomUUID().toString().substring(0, 6).toUpperCase();
        mvc.perform(jsonPost("/api/v1/admin/promotions", promotion("Code offer", false, "FIXED", "300", code.toLowerCase(), true))
                .cookie(admin)).andExpect(status().isCreated());

        // Mistakes are refused with a reason.
        mvc.perform(jsonPost("/api/v1/admin/promotions", promotion("Too much", true, "PERCENT", "95", null, true))
                .cookie(admin)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_VALUE"));
        mvc.perform(jsonPost("/api/v1/admin/promotions", promotion("No code", false, "FIXED", "50", null, true))
                .cookie(admin)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("CODE_REQUIRED"));
        mvc.perform(jsonPost("/api/v1/admin/promotions", promotion("Same code", false, "FIXED", "50", code, true))
                .cookie(admin)).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CODE_EXISTS"));
        mvc.perform(jsonPost("/api/v1/admin/promotions", promotion("Nope", true, "PERCENT", "10", null, true))
                .cookie(customer)).andExpect(status().isForbidden());

        mvc.perform(put("/api/v1/cart/items/" + variant).with(csrf()).cookie(customer)
                .contentType(MediaType.APPLICATION_JSON).content("{\"quantity\":2}")).andExpect(status().isOk());
        quote(null).andExpect(jsonPath("$.discount").value(200.00))
                .andExpect(jsonPath("$.discountLabelEn").value("Season offer"));
        quote(code).andExpect(jsonPath("$.discount").value(300.00)).andExpect(jsonPath("$.promo.applied").value(true));

        // Switching the automatic offer off takes effect at once.
        putJson("/api/v1/admin/promotions/" + automatic, promotion("Season offer", true, "PERCENT", "10", null, false), admin)
                .andExpect(status().isNoContent());
        quote(null).andExpect(jsonPath("$.discount").value(0.00));
        putJson("/api/v1/admin/promotions/" + automatic, promotion("Season offer", false, "PERCENT", "10", "X-CODE", true), admin)
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("CANNOT_CHANGE_KIND"));

        mvc.perform(get("/api/v1/admin/promotions").cookie(admin))
                .andExpect(jsonPath("$[?(@.code=='" + code + "')].redeemedCount").value(0))
                .andExpect(jsonPath("$[?(@.id==" + automatic + ")].active").value(false));
    }

    @Test
    void onlyTheOwnerPublishesPoliciesAndCustomersSeeOnlyPublishedOnes() throws Exception {
        String slug = "exchange-returns";
        jdbc.sql("update policies set status = 'DRAFT', body_en = '', body_ar = '' where slug = :s").param("s", slug).update();
        Map<String, Object> draft = Map.of("titleEn", "Exchange & returns", "titleAr", "الاستبدال والاسترجاع",
                "bodyEn", "Draft wording.\n\nSecond paragraph.", "bodyAr", "صياغة مبدئية.");

        // Staff prepare the draft; customers cannot see it; staff cannot publish it.
        putJson("/api/v1/admin/policies/" + slug, draft, admin).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/content/policies/" + slug)).andExpect(status().isNotFound());
        mvc.perform(jsonPost("/api/v1/admin/policies/" + slug + "/publish", Map.of()).cookie(admin))
                .andExpect(status().isForbidden());

        // An empty policy cannot be published even by the owner.
        jdbc.sql("update policies set body_ar = '' where slug = :s").param("s", slug).update();
        mvc.perform(jsonPost("/api/v1/admin/policies/" + slug + "/publish", Map.of()).cookie(owner))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("POLICY_EMPTY"));
        putJson("/api/v1/admin/policies/" + slug, draft, admin).andExpect(status().isNoContent());

        mvc.perform(jsonPost("/api/v1/admin/policies/" + slug + "/publish", Map.of()).cookie(owner))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/content/policies/" + slug))
                .andExpect(status().isOk()).andExpect(jsonPath("$.bodyEn").value("Draft wording.\n\nSecond paragraph."));
        mvc.perform(get("/api/v1/content/site")).andExpect(jsonPath("$.policies[?(@.slug=='" + slug + "')]").exists());

        // Once customers can read it, only the owner may change the wording.
        Map<String, Object> changed = new HashMap<>(draft);
        changed.put("bodyEn", "Changed by staff.");
        putJson("/api/v1/admin/policies/" + slug, changed, admin).andExpect(status().isForbidden());
        putJson("/api/v1/admin/policies/" + slug, changed, owner).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/content/policies/" + slug)).andExpect(jsonPath("$.bodyEn").value("Changed by staff."));

        mvc.perform(jsonPost("/api/v1/admin/policies/" + slug + "/unpublish", Map.of()).cookie(owner))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/content/policies/" + slug)).andExpect(status().isNotFound());
    }

    @Test
    void questionsAreManagedByStaffAndShownWhenPublished() throws Exception {
        String question = "How long is delivery? " + UUID.randomUUID().toString().substring(0, 6);
        Map<String, Object> faq = new HashMap<>(Map.of("questionEn", question, "questionAr", "كم يستغرق التوصيل؟",
                "answerEn", "See the delivery policy.", "answerAr", "راجع سياسة التوصيل.", "sortOrder", 1,
                "published", false));
        int id = body(mvc.perform(jsonPost("/api/v1/admin/faq", faq).cookie(admin)).andExpect(status().isCreated())
                .andReturn()).get("id").asInt();
        mvc.perform(get("/api/v1/content/faq")).andExpect(jsonPath("$[?(@.questionEn=='" + question + "')]").isEmpty());

        faq.put("published", true);
        putJson("/api/v1/admin/faq/" + id, faq, admin).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/content/faq")).andExpect(jsonPath("$[?(@.questionEn=='" + question + "')]").exists());

        mvc.perform(delete("/api/v1/admin/faq/" + id).with(csrf()).cookie(customer)).andExpect(status().isForbidden());
        mvc.perform(delete("/api/v1/admin/faq/" + id).with(csrf()).cookie(admin)).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/content/faq")).andExpect(jsonPath("$[?(@.questionEn=='" + question + "')]").isEmpty());
        assertThat(jdbc.sql("select count(*) from audit_logs where entity_type = 'faq' and entity_id = :id")
                .param("id", String.valueOf(id)).query(Long.class).single()).isEqualTo(3);
    }

    // ── helpers ──

    private Map<String, Object> productUpdate(String price, String salePrice) {
        Map<String, Object> body = new HashMap<>();
        body.put("nameEn", "Renamed Jacket");
        body.put("nameAr", "جاكيت");
        body.put("categorySlug", category);
        body.put("descriptionEn", "Warm and light.");
        body.put("descriptionAr", "دافئ وخفيف.");
        body.put("badge", "NEW");
        body.put("price", new BigDecimal(price));
        body.put("salePrice", new BigDecimal(salePrice));
        body.put("featured", true);
        return body;
    }

    private Map<String, Object> promotion(String name, boolean automatic, String type, String value, String code,
            boolean active) {
        Map<String, Object> body = new HashMap<>();
        body.put("nameEn", name);
        body.put("nameAr", name);
        body.put("automatic", automatic);
        body.put("type", type);
        body.put("value", new BigDecimal(value));
        body.put("scope", "CATEGORY");
        body.put("targetIds", List.of(categoryId));
        body.put("active", active);
        body.put("code", code);
        return body;
    }

    private ResultActions quote(String promoCode) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("promoCode", promoCode);
        return mvc.perform(jsonPost("/api/v1/checkout/quote", body).cookie(customer)).andExpect(status().isOk());
    }

    private ResultActions putJson(String url, Object body, Cookie cookie) throws Exception {
        return mvc.perform(put(url).with(csrf()).cookie(cookie).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body)));
    }
}
