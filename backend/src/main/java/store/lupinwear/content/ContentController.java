package store.lupinwear.content;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.List;
import store.lupinwear.payment.PaymentMethods;
import store.lupinwear.payment.PaymentMethods.Instapay;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.shared.ApiException;

/** Public, read-only site content. Only published policies and FAQ entries are ever returned. */
@RestController
@RequestMapping("/api/v1/content")
public class ContentController {

    public record PolicyLink(String slug, String titleEn, String titleAr) {
    }

    public record PolicyView(String slug, String titleEn, String titleAr, String bodyEn, String bodyAr) {
    }

    public record FaqView(String questionEn, String questionAr, String answerEn, String answerAr) {
    }

    public record SiteView(JsonNode brand, JsonNode hero, JsonNode announcement, JsonNode contact,
            JsonNode homeSections, BigDecimal freeDeliveryThreshold, Map<String, Boolean> paymentMethods,
            Instapay instapay, List<PolicyLink> policies) {
    }

    private final SiteSettings settings;
    private final JdbcClient jdbc;
    private final PaymentMethods paymentMethods;

    public ContentController(SiteSettings settings, JdbcClient jdbc, PaymentMethods paymentMethods) {
        this.paymentMethods = paymentMethods;
        this.settings = settings;
        this.jdbc = jdbc;
    }

    @GetMapping("/site")
    SiteView site() {
        List<PolicyLink> policies = jdbc.sql("select slug, title_en, title_ar from policies"
                + " where status = 'PUBLISHED' order by sort_order, id")
                .query((rs, n) -> new PolicyLink(rs.getString(1), rs.getString(2), rs.getString(3))).list();
        return new SiteView(settings.get("brand"), settings.get("hero"), settings.get("announcement"),
                settings.get("contact"), settings.get("home_sections"), settings.freeDeliveryThreshold(),
                paymentMethods.all(), paymentMethods.instapay().orElse(null), policies);
    }

    @GetMapping("/policies/{slug}")
    PolicyView policy(@PathVariable String slug) {
        return jdbc.sql("select slug, title_en, title_ar, body_en, body_ar from policies"
                + " where slug = :s and status = 'PUBLISHED'").param("s", slug)
                .query((rs, n) -> new PolicyView(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5)))
                .optional().orElseThrow(() -> ApiException.notFound("Policy"));
    }

    @GetMapping("/faq")
    List<FaqView> faq() {
        return jdbc.sql("select question_en, question_ar, answer_en, answer_ar from faq_items"
                + " where published order by sort_order, id")
                .query((rs, n) -> new FaqView(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4)))
                .list();
    }
}
