package store.lupinwear.look;

import java.text.Normalizer;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import store.lupinwear.audit.AuditLog;
import store.lupinwear.look.LookDtos.AdminLookDetail;
import store.lupinwear.look.LookDtos.AdminLookItem;
import store.lupinwear.look.LookDtos.AdminLookRow;
import store.lupinwear.look.LookDtos.LookCreated;
import store.lupinwear.look.LookDtos.LookImageRequest;
import store.lupinwear.look.LookDtos.LookItemRequest;
import store.lupinwear.look.LookDtos.LookRequest;
import store.lupinwear.shared.ApiException;

/** Staff management of looks. Every change is written to the audit log. */
@Service
@Transactional
public class LookAdminService {

    private final JdbcClient jdbc;
    private final AuditLog audit;

    public LookAdminService(JdbcClient jdbc, AuditLog audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public List<AdminLookRow> looks() {
        return jdbc.sql("""
                select l.id, l.slug, l.title_en, l.title_ar, l.status, l.image_url, l.image_source, l.sort_order,
                       (select count(*) from look_items li where li.look_id = l.id) as item_count
                from looks l order by l.sort_order, l.id desc
                """).query((rs, n) -> new AdminLookRow(rs.getLong("id"), rs.getString("slug"),
                        rs.getString("title_en"), rs.getString("title_ar"), rs.getString("status"),
                        rs.getString("image_url"), rs.getString("image_source"), rs.getInt("item_count"),
                        rs.getInt("sort_order")))
                .list();
    }

    @Transactional(readOnly = true)
    public AdminLookDetail look(long id) {
        List<AdminLookItem> items = items(id);
        return jdbc.sql("select * from looks where id = :id").param("id", id)
                .query((rs, n) -> new AdminLookDetail(rs.getLong("id"), rs.getString("slug"), rs.getString("title_en"),
                        rs.getString("title_ar"), rs.getString("description_en"), rs.getString("description_ar"),
                        rs.getString("status"), rs.getString("image_url"), rs.getString("image_public_id"),
                        rs.getString("image_source"), rs.getInt("sort_order"), items))
                .optional().orElseThrow(() -> ApiException.notFound("Look"));
    }

    /** The items with what the AI needs: the role and the first photo of the chosen colour. */
    @Transactional(readOnly = true)
    public List<AdminLookItem> items(long lookId) {
        return jdbc.sql("""
                select li.product_id, p.name_en, p.status, li.color_id, pc.name_en as color_en, pc.hex, li.role,
                       c.name_en as cat_en,
                       (select pi.url from product_images pi where pi.color_id = pc.id order by pi.position limit 1) as image_url
                from look_items li
                join products p on p.id = li.product_id
                join product_colors pc on pc.id = li.color_id
                join categories c on c.id = p.category_id
                where li.look_id = :id order by li.position
                """).param("id", lookId)
                .query((rs, n) -> new AdminLookItem(rs.getLong("product_id"), rs.getString("name_en"),
                        rs.getString("status"), rs.getLong("color_id"), rs.getString("color_en"), rs.getString("hex"),
                        rs.getString("image_url"), rs.getString("role"), rs.getString("cat_en")))
                .list();
    }

    public LookCreated create(UUID actor, LookRequest req) {
        String slug = uniqueSlug(slugify(req.titleEn()));
        long id = jdbc.sql("""
                insert into looks (slug, title_en, title_ar, description_en, description_ar, sort_order)
                values (:slug, :te, :ta, :de, :da, :sort) returning id
                """).param("slug", slug).param("te", req.titleEn().trim()).param("ta", req.titleAr().trim())
                .param("de", orEmpty(req.descriptionEn())).param("da", orEmpty(req.descriptionAr()))
                .param("sort", req.sortOrder() == null ? 0 : req.sortOrder())
                .query(Long.class).single();
        replaceItems(id, req.items());
        audit.record(actor, "LOOK_CREATED", "look", id, Map.of("slug", slug, "items", req.items().size()));
        return new LookCreated(id, slug);
    }

    /**
     * Changing what the model wears makes the photo wrong, so the photo is removed and a published look
     * goes back to draft until a matching photo is approved.
     */
    public void update(UUID actor, long id, LookRequest req) {
        requireLook(id);
        boolean itemsChanged = !sameItems(id, req.items());
        jdbc.sql("""
                update looks set title_en = :te, title_ar = :ta, description_en = :de, description_ar = :da,
                       sort_order = :sort, updated_at = now() where id = :id
                """).param("te", req.titleEn().trim()).param("ta", req.titleAr().trim())
                .param("de", orEmpty(req.descriptionEn())).param("da", orEmpty(req.descriptionAr()))
                .param("sort", req.sortOrder() == null ? 0 : req.sortOrder()).param("id", id).update();
        if (itemsChanged) {
            replaceItems(id, req.items());
            jdbc.sql("""
                    update looks set image_url = null, image_public_id = null, image_source = null,
                           status = 'DRAFT', updated_at = now() where id = :id
                    """).param("id", id).update();
        }
        audit.record(actor, "LOOK_UPDATED", "look", id, Map.of("itemsChanged", itemsChanged));
    }

    public void setImage(UUID actor, long id, LookImageRequest req) {
        requireLook(id);
        if ("AI".equals(req.source()) && items(id).isEmpty()) {
            throw ApiException.badRequest("LOOK_EMPTY", "Add the products before approving a photo.");
        }
        jdbc.sql("""
                update looks set image_url = :url, image_public_id = :pid, image_source = :src, updated_at = now()
                where id = :id
                """).param("url", req.url()).param("pid", req.publicId()).param("src", req.source()).param("id", id)
                .update();
        audit.record(actor, "LOOK_PHOTO_SET", "look", id, Map.of("source", req.source(), "url", req.url()));
    }

    public void setStatus(UUID actor, long id, String status) {
        AdminLookDetail look = look(id);
        if ("PUBLISHED".equals(status)) {
            if (look.imageUrl() == null) {
                throw ApiException.conflict("LOOK_NO_PHOTO", "Approve or upload a photo before publishing.");
            }
            if (look.items().stream().noneMatch(i -> "ACTIVE".equals(i.productStatus()))) {
                throw ApiException.conflict("LOOK_NO_PRODUCTS", "At least one product in the look must be published.");
            }
        }
        jdbc.sql("update looks set status = :s, updated_at = now() where id = :id").param("s", status).param("id", id)
                .update();
        audit.record(actor, "LOOK_STATUS", "look", id, Map.of("status", status));
    }

    /** Returns the photo to remove from storage, if there was one. */
    public String delete(UUID actor, long id) {
        AdminLookDetail look = look(id);
        jdbc.sql("delete from looks where id = :id").param("id", id).update();
        audit.record(actor, "LOOK_DELETED", "look", id, Map.of("slug", look.slug()));
        return look.imagePublicId();
    }

    private void replaceItems(long lookId, List<LookItemRequest> items) {
        Set<Long> products = new HashSet<>();
        for (LookItemRequest item : items) {
            if (!products.add(item.productId())) {
                throw ApiException.badRequest("DUPLICATE_PRODUCT", "Each product can appear once in a look.");
            }
            boolean colourBelongs = jdbc.sql("""
                    select count(*) from product_colors pc join products p on p.id = pc.product_id
                    where pc.id = :c and p.id = :p and p.deleted_at is null
                    """).param("c", item.colorId()).param("p", item.productId()).query(Long.class).single() > 0;
            if (!colourBelongs) {
                throw ApiException.badRequest("INVALID_ITEM", "One of the chosen colours does not belong to its product.");
            }
        }
        jdbc.sql("delete from look_items where look_id = :id").param("id", lookId).update();
        for (int i = 0; i < items.size(); i++) {
            LookItemRequest item = items.get(i);
            jdbc.sql("""
                    insert into look_items (look_id, product_id, color_id, role, position)
                    values (:l, :p, :c, :r, :pos)
                    """).param("l", lookId).param("p", item.productId()).param("c", item.colorId())
                    .param("r", item.role()).param("pos", i).update();
        }
    }

    private boolean sameItems(long lookId, List<LookItemRequest> wanted) {
        List<String> current = jdbc.sql("select product_id, color_id, role from look_items where look_id = :id"
                + " order by position").param("id", lookId)
                .query((rs, n) -> rs.getLong(1) + ":" + rs.getLong(2) + ":" + rs.getString(3)).list();
        return current.equals(wanted.stream().map(i -> i.productId() + ":" + i.colorId() + ":" + i.role()).toList());
    }

    void requireLook(long id) {
        if (jdbc.sql("select count(*) from looks where id = :id").param("id", id).query(Long.class).single() == 0) {
            throw ApiException.notFound("Look");
        }
    }

    private String uniqueSlug(String base) {
        String slug = base;
        for (int n = 2; jdbc.sql("select count(*) from looks where slug = :s").param("s", slug)
                .query(Long.class).single() > 0; n++) {
            slug = base + "-" + n;
        }
        return slug;
    }

    static String slugify(String title) {
        String ascii = Normalizer.normalize(title, Normalizer.Form.NFKD).replaceAll("\\p{M}", "");
        String slug = ascii.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-+|-+$)", "");
        if (slug.isEmpty()) {
            throw ApiException.badRequest("INVALID_NAME", "The English title needs at least one letter or number.");
        }
        return slug.length() > 100 ? slug.substring(0, 100) : slug;
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s.trim();
    }
}
