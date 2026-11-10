package store.lupinwear.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.audit.AuditLog;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.shared.ApiException;

/**
 * Policies and questions &amp; answers. Policy wording is the owner's: staff may prepare drafts, but only
 * the owner can publish a policy or change one that customers can already read. Text is stored and
 * shown as plain text (paragraphs), never as HTML.
 */
@RestController
@RequestMapping("/api/v1/admin")
@PreAuthorize("hasAnyRole('ADMIN','OWNER')")
@Transactional
public class AdminContentController {

    public record PolicyRequest(
            @NotBlank @Size(max = 120) String titleEn,
            @NotBlank @Size(max = 120) String titleAr,
            @NotNull @Size(max = 20000) String bodyEn,
            @NotNull @Size(max = 20000) String bodyAr) {
    }

    public record PolicyView(String slug, String titleEn, String titleAr, String bodyEn, String bodyAr,
            String status) {
    }

    public record FaqRequest(
            @NotBlank @Size(max = 300) String questionEn,
            @NotBlank @Size(max = 300) String questionAr,
            @NotBlank @Size(max = 5000) String answerEn,
            @NotBlank @Size(max = 5000) String answerAr,
            int sortOrder,
            boolean published) {
    }

    public record FaqView(int id, String questionEn, String questionAr, String answerEn, String answerAr,
            int sortOrder, boolean published) {
    }

    private final JdbcClient jdbc;
    private final AuditLog audit;

    public AdminContentController(JdbcClient jdbc, AuditLog audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    // ── policies ──

    @GetMapping("/policies")
    @Transactional(readOnly = true)
    public List<PolicyView> policies() {
        return jdbc.sql("select slug, title_en, title_ar, body_en, body_ar, status from policies order by sort_order, id")
                .query((rs, n) -> new PolicyView(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6)))
                .list();
    }

    @PutMapping("/policies/{slug}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void savePolicy(@AuthenticationPrincipal CurrentUser user, @PathVariable String slug,
            @Valid @RequestBody PolicyRequest body) {
        String status = lockPolicy(slug);
        boolean owner = user.roles().contains("OWNER");
        if ("PUBLISHED".equals(status)) {
            if (!owner) {
                throw forbidden("Only the owner can change a policy that customers can already read.");
            }
            requireText(body.bodyEn(), body.bodyAr());
        }
        // An owner's edit of a published policy is itself the approval of the new wording.
        jdbc.sql("""
                update policies set title_en = :ten, title_ar = :tar, body_en = :ben, body_ar = :bar, updated_at = now(),
                       approved_by = case when status = 'PUBLISHED' then :u else approved_by end,
                       approved_at = case when status = 'PUBLISHED' then now() else approved_at end
                where slug = :s
                """).param("ten", body.titleEn().trim()).param("tar", body.titleAr().trim())
                .param("ben", body.bodyEn().trim()).param("bar", body.bodyAr().trim()).param("u", user.id())
                .param("s", slug).update();
        audit.record(user.id(), "POLICY_SAVE", "policy", slug, Map.of("status", status));
    }

    @PostMapping("/policies/{slug}/publish")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void publishPolicy(@AuthenticationPrincipal CurrentUser user, @PathVariable String slug) {
        lockPolicy(slug);
        if (!user.roles().contains("OWNER")) {
            throw forbidden("Only the owner can publish a policy.");
        }
        record Text(String en, String ar) {
        }
        Text text = jdbc.sql("select body_en, body_ar from policies where slug = :s").param("s", slug)
                .query((rs, n) -> new Text(rs.getString(1), rs.getString(2))).single();
        requireText(text.en(), text.ar());
        jdbc.sql("update policies set status = 'PUBLISHED', approved_by = :u, approved_at = now(), updated_at = now()"
                + " where slug = :s").param("u", user.id()).param("s", slug).update();
        audit.record(user.id(), "POLICY_PUBLISH", "policy", slug, null);
    }

    @PostMapping("/policies/{slug}/unpublish")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unpublishPolicy(@AuthenticationPrincipal CurrentUser user, @PathVariable String slug) {
        lockPolicy(slug);
        if (!user.roles().contains("OWNER")) {
            throw forbidden("Only the owner can take a policy down.");
        }
        jdbc.sql("update policies set status = 'DRAFT', updated_at = now() where slug = :s").param("s", slug).update();
        audit.record(user.id(), "POLICY_UNPUBLISH", "policy", slug, null);
    }

    private String lockPolicy(String slug) {
        return jdbc.sql("select status from policies where slug = :s for update").param("s", slug)
                .query(String.class).optional().orElseThrow(() -> ApiException.notFound("Policy"));
    }

    private static void requireText(String en, String ar) {
        if (en == null || en.isBlank() || ar == null || ar.isBlank()) {
            throw ApiException.badRequest("POLICY_EMPTY", "A published policy needs its text in English and in Arabic.");
        }
    }

    private static ApiException forbidden(String message) {
        return new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", message);
    }

    // ── questions & answers ──

    @GetMapping("/faq")
    @Transactional(readOnly = true)
    public List<FaqView> faq() {
        return jdbc.sql("select id, question_en, question_ar, answer_en, answer_ar, sort_order, published"
                + " from faq_items order by sort_order, id")
                .query((rs, n) -> new FaqView(rs.getInt(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getInt(6), rs.getBoolean(7)))
                .list();
    }

    @PostMapping("/faq")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Integer> createFaq(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody FaqRequest body) {
        int id = jdbc.sql("""
                insert into faq_items (question_en, question_ar, answer_en, answer_ar, sort_order, published)
                values (:qen, :qar, :aen, :aar, :ord, :pub) returning id
                """).param("qen", body.questionEn().trim()).param("qar", body.questionAr().trim())
                .param("aen", body.answerEn().trim()).param("aar", body.answerAr().trim())
                .param("ord", body.sortOrder()).param("pub", body.published()).query(Integer.class).single();
        audit.record(user.id(), "FAQ_CREATE", "faq", id, null);
        return Map.of("id", id);
    }

    @PutMapping("/faq/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void updateFaq(@AuthenticationPrincipal CurrentUser user, @PathVariable int id,
            @Valid @RequestBody FaqRequest body) {
        int rows = jdbc.sql("""
                update faq_items set question_en = :qen, question_ar = :qar, answer_en = :aen, answer_ar = :aar,
                       sort_order = :ord, published = :pub, updated_at = now()
                where id = :id
                """).param("qen", body.questionEn().trim()).param("qar", body.questionAr().trim())
                .param("aen", body.answerEn().trim()).param("aar", body.answerAr().trim())
                .param("ord", body.sortOrder()).param("pub", body.published()).param("id", id).update();
        if (rows == 0) {
            throw ApiException.notFound("Question");
        }
        audit.record(user.id(), "FAQ_UPDATE", "faq", id, null);
    }

    @DeleteMapping("/faq/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteFaq(@AuthenticationPrincipal CurrentUser user, @PathVariable int id) {
        if (jdbc.sql("delete from faq_items where id = :id").param("id", id).update() == 0) {
            throw ApiException.notFound("Question");
        }
        audit.record(user.id(), "FAQ_DELETE", "faq", id, null);
    }
}
