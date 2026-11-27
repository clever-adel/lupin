package store.lupinwear.review;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.audit.AuditLog;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.shared.ApiException;

/**
 * Customer reviews. A customer can rate each piece of an order once it is delivered (one review per
 * bought piece). Staff approve or reject each review; only approved ones appear on the product page,
 * with the reviewer's first name and initial.
 */
@RestController
@Transactional
public class ReviewController {

    public record Reviewable(long orderItemId, String productSlug, String nameEn, String nameAr, String color,
            String size, String imageUrl, Integer rating, String status) {
    }

    public record ReviewRequest(@NotNull Long orderItemId, @NotNull @Min(1) @Max(5) Integer rating,
            @Size(max = 1000) String body) {
    }

    public record PublicReview(long id, int rating, String body, String name, Instant createdAt) {
    }

    public record ProductReviews(int count, BigDecimal average, List<PublicReview> reviews) {
    }

    public record AdminReview(long id, String productSlug, String productName, String customerName, String customerEmail,
            String orderReference, int rating, String body, String status, Instant createdAt) {
    }

    public record ModerateRequest(@NotNull @Pattern(regexp = "APPROVED|REJECTED") String status) {
    }

    private final JdbcClient jdbc;
    private final AuditLog audit;

    public ReviewController(JdbcClient jdbc, AuditLog audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    /** The pieces of one of the customer's own delivered orders, with their review if they left one. */
    @GetMapping("/api/v1/orders/{reference}/reviews")
    @Transactional(readOnly = true)
    public List<Reviewable> reviewable(@AuthenticationPrincipal CurrentUser user, @PathVariable String reference) {
        String status = jdbc.sql("select status from orders where reference = :r and user_id = :u")
                .param("r", reference).param("u", user.id()).query(String.class).optional()
                .orElseThrow(() -> ApiException.notFound("Order"));
        if (!"DELIVERED".equals(status)) {
            return List.of();
        }
        return jdbc.sql("""
                select i.id, p.slug, i.product_name, coalesce(nullif(i.product_name_ar, ''), i.product_name),
                       i.color_name, i.size_code, i.image_url, r.rating, r.status
                from order_items i join orders o on o.id = i.order_id
                left join products p on p.id = i.product_id and p.deleted_at is null
                left join reviews r on r.order_item_id = i.id
                where o.reference = :r and o.user_id = :u and i.product_id is not null
                order by i.id
                """).param("r", reference).param("u", user.id())
                .query((rs, n) -> new Reviewable(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6), rs.getString(7),
                        rs.getObject(8) == null ? null : rs.getInt(8), rs.getString(9)))
                .list();
    }

    @PostMapping("/api/v1/reviews")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Long> create(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody ReviewRequest body) {
        record Item(long productId, String status) {
        }
        Item item = jdbc.sql("""
                select i.product_id, o.status from order_items i join orders o on o.id = i.order_id
                where i.id = :i and o.user_id = :u and i.product_id is not null
                """).param("i", body.orderItemId()).param("u", user.id())
                .query((rs, n) -> new Item(rs.getLong(1), rs.getString(2))).optional()
                .orElseThrow(() -> ApiException.notFound("Order item"));
        if (!"DELIVERED".equals(item.status())) {
            throw ApiException.conflict("NOT_DELIVERED", "You can review a piece once your order is delivered.");
        }
        boolean done = jdbc.sql("select count(*) from reviews where order_item_id = :i").param("i", body.orderItemId())
                .query(Long.class).single() > 0;
        if (done) {
            throw ApiException.conflict("ALREADY_REVIEWED", "You already reviewed this piece.");
        }
        String text = body.body() == null ? "" : body.body().strip();
        long id = jdbc.sql("""
                insert into reviews (product_id, user_id, order_item_id, rating, body)
                values (:p, :u, :i, :r, :b) returning id
                """).param("p", item.productId()).param("u", user.id()).param("i", body.orderItemId())
                .param("r", body.rating()).param("b", text).query(Long.class).single();
        return Map.of("id", id);
    }

    /** Approved reviews of a product, newest first, with the average rating. */
    @GetMapping("/api/v1/catalog/products/{slug}/reviews")
    @Transactional(readOnly = true)
    public ProductReviews forProduct(@PathVariable String slug, @RequestParam(defaultValue = "20") int limit) {
        // The name the customer gave on the order (guests have no real account name).
        String where = " from reviews r join products p on p.id = r.product_id"
                + " join order_items i on i.id = r.order_item_id join orders o on o.id = i.order_id"
                + " where p.slug = :s and p.deleted_at is null and r.status = 'APPROVED'";
        record Stats(int count, BigDecimal average) {
        }
        Stats stats = jdbc.sql("select count(*), avg(r.rating)" + where).param("s", slug)
                .query((rs, n) -> new Stats(rs.getInt(1), rs.getBigDecimal(2) == null ? BigDecimal.ZERO
                        : rs.getBigDecimal(2).setScale(1, RoundingMode.HALF_UP)))
                .single();
        List<PublicReview> reviews = jdbc.sql("select r.id, r.rating, r.body, o.customer_name, r.created_at" + where
                        + " order by r.created_at desc limit :limit")
                .param("s", slug).param("limit", Math.clamp(limit, 1, 50))
                .query((rs, n) -> new PublicReview(rs.getLong(1), rs.getInt(2), rs.getString(3),
                        shortName(rs.getString(4)), rs.getObject(5, OffsetDateTime.class).toInstant()))
                .list();
        return new ProductReviews(stats.count(), stats.average(), reviews);
    }

    @GetMapping("/api/v1/admin/reviews")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER')")
    @Transactional(readOnly = true)
    public List<AdminReview> list(@RequestParam(defaultValue = "PENDING") String status) {
        if (!List.of("PENDING", "APPROVED", "REJECTED").contains(status)) {
            throw ApiException.badRequest("BAD_STATUS", "Unknown review status.");
        }
        return jdbc.sql("""
                select r.id, p.slug, p.name_en, o.customer_name, u.email, o.reference, r.rating, r.body, r.status, r.created_at
                from reviews r join products p on p.id = r.product_id join users u on u.id = r.user_id
                join order_items i on i.id = r.order_item_id join orders o on o.id = i.order_id
                where r.status = :s order by r.created_at desc limit 200
                """).param("s", status)
                .query((rs, n) -> new AdminReview(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6), rs.getInt(7), rs.getString(8), rs.getString(9),
                        rs.getObject(10, OffsetDateTime.class).toInstant()))
                .list();
    }

    @PostMapping("/api/v1/admin/reviews/{id}/status")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void moderate(@AuthenticationPrincipal CurrentUser user, @PathVariable long id,
            @Valid @RequestBody ModerateRequest body) {
        int rows = jdbc.sql("update reviews set status = :s, moderated_by = :u, moderated_at = now() where id = :id")
                .param("s", body.status()).param("u", user.id()).param("id", id).update();
        if (rows == 0) {
            throw ApiException.notFound("Review");
        }
        audit.record(user.id(), "REVIEW_" + body.status(), "review", id, null);
    }

    /** "Ahmed Mohamed Ali" → "Ahmed M."; one word stays as it is. */
    static String shortName(String fullName) {
        String[] parts = (fullName == null ? "" : fullName.strip()).split("\\s+");
        if (parts.length == 0 || parts[0].isEmpty()) {
            return "";
        }
        return parts.length == 1 ? parts[0] : parts[0] + " " + parts[1].substring(0, 1) + ".";
    }
}
