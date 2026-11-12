package store.lupinwear.catalog.application;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashMap;
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
import store.lupinwear.catalog.api.CatalogDtos.CategoryRequest;
import store.lupinwear.catalog.api.CatalogDtos.ColorRequest;
import store.lupinwear.catalog.api.CatalogDtos.ImageRequest;
import store.lupinwear.catalog.api.CatalogDtos.InitialVariantStock;
import store.lupinwear.catalog.api.CatalogDtos.ProductCreated;
import store.lupinwear.catalog.api.CatalogDtos.ProductRequest;
import store.lupinwear.catalog.api.CatalogDtos.StockView;
import store.lupinwear.catalog.api.CatalogDtos.AdminProductDetail;
import store.lupinwear.catalog.api.CatalogDtos.AdminColor;
import store.lupinwear.catalog.api.CatalogDtos.AdminImage;
import store.lupinwear.catalog.api.CatalogDtos.AdminProductRow;
import store.lupinwear.catalog.api.CatalogDtos.ProductUpdateRequest;
import store.lupinwear.catalog.api.CatalogDtos.AdminVariantRow;
import store.lupinwear.shared.ApiException;
import store.lupinwear.shared.PageResponse;

@Service
@Transactional
public class CatalogAdminService {

    private final JdbcClient jdbc;
    private final AuditLog audit;

    public CatalogAdminService(JdbcClient jdbc, AuditLog audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    public void setDepartmentStatus(UUID actor, String slug, String status) {
        int rows = jdbc.sql("update departments set status = :status, updated_at = now() where slug = :slug")
                .param("status", status).param("slug", slug).update();
        if (rows == 0) {
            throw ApiException.notFound("Department");
        }
        audit.record(actor, "DEPARTMENT_STATUS", "department", slug, Map.of("status", status));
    }

    public String createCategory(UUID actor, CategoryRequest req) {
        int departmentId = departmentId(req.departmentSlug());
        Integer parentId = req.parentSlug() == null || req.parentSlug().isBlank() ? null
                : categoryId(departmentId, req.parentSlug());
        String slug = slugify(req.nameEn());
        boolean taken = jdbc.sql("select count(*) from categories where department_id = :d and slug = :s")
                .param("d", departmentId).param("s", slug).query(Long.class).single() > 0;
        if (taken) {
            throw ApiException.conflict("CATEGORY_EXISTS", "This department already has a category with that name.");
        }
        jdbc.sql("""
                insert into categories (department_id, parent_id, slug, name_en, name_ar)
                values (:d, :p, :s, :en, :ar)
                """).param("d", departmentId).param("p", parentId).param("s", slug)
                .param("en", req.nameEn().trim()).param("ar", req.nameAr().trim()).update();
        audit.record(actor, "CATEGORY_CREATE", "category", slug, req);
        return slug;
    }

    /** Creates a draft product with its colours, photos, one variant per colour × size, and stock rows. */
    public ProductCreated createProduct(UUID actor, ProductRequest req) {
        validate(req);
        Map<String, Integer> stockByVariant = stockByVariant(req);
        int departmentId = departmentId(req.departmentSlug());
        int categoryId = categoryId(departmentId, req.categorySlug());
        String sizeGroup = req.sizeGroup() == null ? "ADULT" : req.sizeGroup();

        List<Integer> sizeIds = new ArrayList<>();
        for (String code : req.sizes()) {
            sizeIds.add(jdbc.sql("select id from sizes where size_group = :g and code = :c")
                    .param("g", sizeGroup).param("c", code.trim().toUpperCase(Locale.ROOT))
                    .query(Integer.class).optional()
                    .orElseThrow(() -> ApiException.badRequest("UNKNOWN_SIZE", "Unknown size: " + code)));
        }

        String slug = uniqueSlug(slugify(req.nameEn()));
        long productId = jdbc.sql("""
                insert into products (slug, department_id, category_id, name_en, name_ar, description_en, description_ar,
                                      fabric_en, fabric_ar, fit_en, fit_ar, brand, badge, price, sale_price)
                values (:slug, :dep, :cat, :nameEn, :nameAr, :descEn, :descAr, :fabricEn, :fabricAr, :fitEn, :fitAr,
                        :brand, :badge, :price, :salePrice)
                returning id
                """)
                .param("slug", slug).param("dep", departmentId).param("cat", categoryId)
                .param("nameEn", req.nameEn().trim()).param("nameAr", req.nameAr().trim())
                .param("descEn", orEmpty(req.descriptionEn())).param("descAr", orEmpty(req.descriptionAr()))
                .param("fabricEn", orEmpty(req.fabricEn())).param("fabricAr", orEmpty(req.fabricAr()))
                .param("fitEn", orEmpty(req.fitEn())).param("fitAr", orEmpty(req.fitAr()))
                .param("brand", req.brand()).param("badge", req.badge())
                .param("price", req.price()).param("salePrice", req.salePrice())
                .query(Long.class).single();

        int stock = req.initialStockPerVariant() == null ? 0 : req.initialStockPerVariant();
        List<Long> variantIds = new ArrayList<>();
        int colorOrder = 0;
        for (ColorRequest color : req.colors()) {
            int colorIndex = colorOrder;
            long colorId = jdbc.sql("""
                    insert into product_colors (product_id, name_en, name_ar, hex, is_main, sort_order)
                    values (:p, :en, :ar, :hex, :main, :ord) returning id
                    """).param("p", productId).param("en", color.nameEn().trim()).param("ar", color.nameAr().trim())
                    .param("hex", color.hex().toUpperCase(Locale.ROOT)).param("main", color.main())
                    .param("ord", colorOrder++).query(Long.class).single();

            List<ImageRequest> images = color.images() == null ? List.of() : color.images();
            for (int i = 0; i < images.size(); i++) {
                ImageRequest img = images.get(i);
                jdbc.sql("""
                        insert into product_images (color_id, public_id, url, alt_en, alt_ar, position)
                        values (:c, :pid, :url, :altEn, :altAr, :pos)
                        """).param("c", colorId).param("pid", img.publicId()).param("url", img.url())
                        .param("altEn", orEmpty(img.altEn())).param("altAr", orEmpty(img.altAr()))
                        .param("pos", (short) i).update();
            }
            for (int sizeIndex = 0; sizeIndex < sizeIds.size(); sizeIndex++) {
                int sizeId = sizeIds.get(sizeIndex);
                String sizeCode = req.sizes().get(sizeIndex).trim().toUpperCase(Locale.ROOT);
                int variantStock = stockByVariant.getOrDefault(stockKey(colorIndex, sizeCode), stock);
                long variantId = jdbc.sql("""
                        insert into product_variants (product_id, color_id, size_id, sku)
                        values (:p, :c, :s, :sku) returning id
                        """).param("p", productId).param("c", colorId).param("s", sizeId)
                        .param("sku", "LP-" + productId + "-" + colorId + "-" + sizeId)
                        .query(Long.class).single();
                jdbc.sql("insert into inventory (variant_id, on_hand) values (:v, :q)")
                        .param("v", variantId).param("q", variantStock).update();
                if (variantStock > 0) {
                    movement(variantId, "RECEIVE", variantStock, "Initial stock", actor);
                }
                variantIds.add(variantId);
            }
        }
        audit.record(actor, "PRODUCT_CREATE", "product", productId, Map.of("slug", slug, "price", req.price()));
        return new ProductCreated(productId, slug, variantIds);
    }

    public void setProductStatus(UUID actor, long productId, String status) {
        if ("ACTIVE".equals(status)) {
            long variants = jdbc.sql("select count(*) from product_variants where product_id = :p and active")
                    .param("p", productId).query(Long.class).single();
            long mainColors = jdbc.sql("select count(*) from product_colors where product_id = :p and is_main")
                    .param("p", productId).query(Long.class).single();
            if (variants == 0 || mainColors != 1) {
                throw ApiException.badRequest("PRODUCT_INCOMPLETE",
                        "A product needs a main colour and at least one size before it can go live.");
            }
        }
        int rows = jdbc.sql("""
                update products set status = :status, updated_at = now(), version = version + 1,
                       published_at = case when :status = 'ACTIVE' then coalesce(published_at, now()) else published_at end
                where id = :id and deleted_at is null
                """).param("status", status).param("id", productId).update();
        if (rows == 0) {
            throw ApiException.notFound("Product");
        }
        audit.record(actor, "PRODUCT_STATUS", "product", productId, Map.of("status", status));
    }

    /** Stock can never drop below what is already reserved for open orders. */
    public StockView adjustStock(UUID actor, long variantId, int delta, String note) {
        if (delta == 0) {
            throw ApiException.badRequest("NO_CHANGE", "Enter a quantity to add or remove.");
        }
        int rows = jdbc.sql("""
                update inventory set on_hand = on_hand + :delta, updated_at = now()
                where variant_id = :v and on_hand + :delta >= reserved
                """).param("delta", delta).param("v", variantId).update();
        if (rows == 0) {
            boolean exists = jdbc.sql("select count(*) from inventory where variant_id = :v")
                    .param("v", variantId).query(Long.class).single() > 0;
            if (!exists) {
                throw ApiException.notFound("Variant");
            }
            throw ApiException.conflict("STOCK_BELOW_RESERVED",
                    "You cannot remove stock that is already reserved for open orders.");
        }
        movement(variantId, delta > 0 ? "RECEIVE" : "ADJUST", delta, note, actor);
        audit.record(actor, "STOCK_ADJUST", "variant", variantId, Map.of("delta", delta));
        return stock(variantId);
    }

    @Transactional(readOnly = true)
    public StockView stock(long variantId) {
        return jdbc.sql("select variant_id, on_hand, reserved from inventory where variant_id = :v")
                .param("v", variantId)
                .query((rs, n) -> new StockView(rs.getLong(1), rs.getInt(2), rs.getInt(3), rs.getInt(2) - rs.getInt(3)))
                .optional().orElseThrow(() -> ApiException.notFound("Variant"));
    }

    @Transactional(readOnly = true)
    public AdminProductDetail productForEdit(long id) {
        AdminProductDetail product = jdbc.sql("""
                select p.id, p.slug, p.status, d.slug, c.slug, p.name_en, p.name_ar, p.description_en,
                       p.description_ar, p.fabric_en, p.fabric_ar, p.fit_en, p.fit_ar, p.badge, p.price, p.sale_price,
                       p.featured
                from products p join departments d on d.id = p.department_id join categories c on c.id = p.category_id
                where p.id = :id and p.deleted_at is null
                """).param("id", id)
                .query((rs, n) -> new AdminProductDetail(rs.getLong(1), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8),
                        rs.getString(9), rs.getString(10), rs.getString(11), rs.getString(12), rs.getString(13),
                        rs.getString(14), rs.getBigDecimal(15), rs.getBigDecimal(16), rs.getBoolean(17), List.of()))
                .optional().orElseThrow(() -> ApiException.notFound("Product"));
        record ColorHead(long id, String nameEn, String nameAr, String hex) {
        }
        List<ColorHead> colorHeads = jdbc.sql("""
                select id, name_en, name_ar, hex from product_colors where product_id = :p order by sort_order, id
                """).param("p", id).query((rs, n) -> new ColorHead(rs.getLong(1), rs.getString(2), rs.getString(3),
                        rs.getString(4))).list();
        Map<Long, List<AdminImage>> imagesByColor = new HashMap<>();
        if (!colorHeads.isEmpty()) {
            jdbc.sql("""
                    select pi.color_id, pi.id, pi.public_id, pi.url, pi.alt_en, pi.alt_ar
                    from product_images pi join product_colors pc on pc.id = pi.color_id
                    where pc.product_id = :p order by pc.sort_order, pi.position, pi.id
                    """).param("p", id).query((rs, n) -> imagesByColor
                    .computeIfAbsent(rs.getLong(1), key -> new ArrayList<>())
                    .add(new AdminImage(rs.getLong(2), rs.getString(3), rs.getString(4), rs.getString(5),
                            rs.getString(6)))).list();
        }
        List<AdminColor> colors = colorHeads.stream().map(color -> new AdminColor(color.id(), color.nameEn(),
                color.nameAr(), color.hex(), imagesByColor.getOrDefault(color.id(), List.of()))).toList();
        return new AdminProductDetail(product.id(), product.slug(), product.status(), product.departmentSlug(),
                product.categorySlug(), product.nameEn(), product.nameAr(), product.descriptionEn(),
                product.descriptionAr(), product.fabricEn(), product.fabricAr(), product.fitEn(), product.fitAr(),
                product.badge(), product.price(), product.salePrice(), product.featured(), colors);
    }

    public void replaceColorImages(UUID actor, long productId, long colorId, List<ImageRequest> images) {
        boolean belongs = jdbc.sql("""
                select count(*) from product_colors c join products p on p.id = c.product_id
                where c.id = :c and c.product_id = :p and p.deleted_at is null
                """)
                .param("c", colorId).param("p", productId).query(Long.class).single() > 0;
        if (!belongs) throw ApiException.notFound("Colour");
        jdbc.sql("delete from product_images where color_id = :c").param("c", colorId).update();
        List<ImageRequest> safeImages = images == null ? List.of() : images;
        for (int i = 0; i < safeImages.size(); i++) {
            ImageRequest image = safeImages.get(i);
            jdbc.sql("""
                    insert into product_images (color_id, public_id, url, alt_en, alt_ar, position)
                    values (:c, :pid, :url, :altEn, :altAr, :pos)
                    """).param("c", colorId).param("pid", image.publicId()).param("url", image.url())
                    .param("altEn", orEmpty(image.altEn())).param("altAr", orEmpty(image.altAr()))
                    .param("pos", (short) i).update();
        }
        audit.record(actor, "PRODUCT_COLOUR_IMAGES_UPDATE", "product_colour", colorId,
                Map.of("productId", productId, "imageCount", safeImages.size()));
    }

    /** Orders already placed keep the name and price they were bought at; this only affects what is sold next. */
    public void updateProduct(UUID actor, long id, ProductUpdateRequest req) {
        if (req.salePrice() != null && req.salePrice().compareTo(req.price()) >= 0) {
            throw ApiException.badRequest("SALE_PRICE_TOO_HIGH", "The discount price must be lower than the price.");
        }
        Integer departmentId = jdbc.sql("select department_id from products where id = :id and deleted_at is null"
                + " for update").param("id", id).query(Integer.class).optional()
                .orElseThrow(() -> ApiException.notFound("Product"));
        jdbc.sql("""
                update products set name_en = :nameEn, name_ar = :nameAr, category_id = :cat,
                       description_en = :descEn, description_ar = :descAr, fabric_en = :fabricEn, fabric_ar = :fabricAr,
                       fit_en = :fitEn, fit_ar = :fitAr, badge = :badge, price = :price, sale_price = :salePrice,
                       featured = :featured, updated_at = now(), version = version + 1
                where id = :id
                """).param("nameEn", req.nameEn().trim()).param("nameAr", req.nameAr().trim())
                .param("cat", categoryId(departmentId, req.categorySlug()))
                .param("descEn", orEmpty(req.descriptionEn())).param("descAr", orEmpty(req.descriptionAr()))
                .param("fabricEn", orEmpty(req.fabricEn())).param("fabricAr", orEmpty(req.fabricAr()))
                .param("fitEn", orEmpty(req.fitEn())).param("fitAr", orEmpty(req.fitAr()))
                .param("badge", req.badge()).param("price", req.price()).param("salePrice", req.salePrice())
                .param("featured", req.featured()).param("id", id).update();
        audit.record(actor, "PRODUCT_UPDATE", "product", id,
                Map.of("price", req.price(), "salePrice", req.salePrice() == null ? "" : req.salePrice()));
    }

    /** Every product, whatever its status, with the stock of each variant. Two queries per page. */
    @Transactional(readOnly = true)
    public PageResponse<AdminProductRow> products(String query, String status, int page, int pageSize) {
        int size = Math.clamp(pageSize, 1, 50);
        int index = Math.max(page, 0);
        Map<String, Object> params = new java.util.HashMap<>();
        StringBuilder where = new StringBuilder(" from products p where p.deleted_at is null");
        if (status != null && !status.isBlank()) {
            where.append(" and p.status = :status");
            params.put("status", status);
        }
        if (query != null && !query.isBlank()) {
            where.append(" and (p.name_en ilike :q escape '\\' or p.name_ar ilike :q escape '\\')");
            params.put("q", "%" + query.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
        }
        long total = jdbc.sql("select count(*)" + where).params(params).query(Long.class).single();
        if (total == 0) {
            return PageResponse.of(List.of(), index, size, 0);
        }
        params.put("limit", size);
        params.put("offset", (long) index * size);
        record Head(long id, String slug, String nameEn, String nameAr, String status, java.math.BigDecimal price,
                java.math.BigDecimal salePrice) {
        }
        List<Head> heads = jdbc.sql("select p.id, p.slug, p.name_en, p.name_ar, p.status, p.price, p.sale_price"
                + where + " order by p.id desc limit :limit offset :offset").params(params)
                .query((rs, n) -> new Head(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getBigDecimal(6), rs.getBigDecimal(7)))
                .list();
        Map<Long, List<AdminVariantRow>> variants = new java.util.HashMap<>();
        jdbc.sql("""
                select v.product_id, v.id, pc.name_en, s.code, v.sku, i.on_hand, i.reserved
                from product_variants v join product_colors pc on pc.id = v.color_id
                join sizes s on s.id = v.size_id join inventory i on i.variant_id = v.id
                where v.product_id in (:ids) order by pc.sort_order, pc.id, s.sort_order
                """).param("ids", heads.stream().map(Head::id).toList())
                .query((rs, n) -> variants.computeIfAbsent(rs.getLong(1), k -> new ArrayList<>())
                        .add(new AdminVariantRow(rs.getLong(2), rs.getString(3), rs.getString(4), rs.getString(5),
                                rs.getInt(6), rs.getInt(7), rs.getInt(6) - rs.getInt(7))))
                .list();
        return PageResponse.of(heads.stream().map(h -> new AdminProductRow(h.id(), h.slug(), h.nameEn(), h.nameAr(),
                h.status(), h.price(), h.salePrice(), variants.getOrDefault(h.id(), List.of()))).toList(),
                index, size, total);
    }

    private void movement(long variantId, String type, int quantity, String note, UUID actor) {
        jdbc.sql("""
                insert into inventory_movements (variant_id, type, quantity, note, actor_user_id)
                values (:v, :t, :q, :n, :a)
                """).param("v", variantId).param("t", type).param("q", quantity).param("n", note).param("a", actor)
                .update();
    }

    private static void validate(ProductRequest req) {
        if (req.salePrice() != null && req.salePrice().compareTo(req.price()) >= 0) {
            throw ApiException.badRequest("SALE_PRICE_TOO_HIGH", "The discount price must be lower than the price.");
        }
        if (req.colors().stream().filter(ColorRequest::main).count() != 1) {
            throw ApiException.badRequest("MAIN_COLOUR_REQUIRED", "Choose exactly one main colour.");
        }
        Set<String> names = new HashSet<>();
        for (ColorRequest c : req.colors()) {
            if (!names.add(c.nameEn().trim().toLowerCase(Locale.ROOT))) {
                throw ApiException.badRequest("DUPLICATE_COLOUR", "Each colour can be added once.");
            }
        }
        if (new HashSet<>(req.sizes()).size() != req.sizes().size()) {
            throw ApiException.badRequest("DUPLICATE_SIZE", "Each size can be added once.");
        }
    }

    private static Map<String, Integer> stockByVariant(ProductRequest req) {
        if (req.stockByVariant() == null || req.stockByVariant().isEmpty()) return Map.of();
        Map<String, Integer> result = new HashMap<>();
        for (InitialVariantStock stock : req.stockByVariant()) {
            if (stock.colorIndex() >= req.colors().size()) {
                throw ApiException.badRequest("UNKNOWN_STOCK_VARIANT", "Stock refers to an unknown colour.");
            }
            String sizeCode = stock.sizeCode().trim().toUpperCase(Locale.ROOT);
            boolean sizeExists = req.sizes().stream()
                    .anyMatch(size -> size.trim().equalsIgnoreCase(sizeCode));
            if (!sizeExists) {
                throw ApiException.badRequest("UNKNOWN_STOCK_VARIANT", "Stock refers to an unknown size.");
            }
            String key = stockKey(stock.colorIndex(), sizeCode);
            if (result.putIfAbsent(key, stock.quantity()) != null) {
                throw ApiException.badRequest("DUPLICATE_STOCK_VARIANT", "Stock can be set once per colour and size.");
            }
        }
        return Map.copyOf(result);
    }

    private static String stockKey(int colorIndex, String sizeCode) {
        return colorIndex + ":" + sizeCode;
    }

    private int departmentId(String slug) {
        return jdbc.sql("select id from departments where slug = :s").param("s", slug).query(Integer.class)
                .optional().orElseThrow(() -> ApiException.badRequest("UNKNOWN_DEPARTMENT", "Unknown department."));
    }

    private int categoryId(int departmentId, String slug) {
        return jdbc.sql("select id from categories where department_id = :d and slug = :s")
                .param("d", departmentId).param("s", slug).query(Integer.class)
                .optional().orElseThrow(() -> ApiException.badRequest("UNKNOWN_CATEGORY", "Unknown category."));
    }

    private String uniqueSlug(String base) {
        String slug = base;
        for (int i = 2; exists(slug); i++) {
            slug = base + "-" + i;
        }
        return slug;
    }

    private boolean exists(String slug) {
        return jdbc.sql("select count(*) from products where slug = :s").param("s", slug).query(Long.class).single() > 0;
    }

    static String slugify(String name) {
        String ascii = Normalizer.normalize(name, Normalizer.Form.NFKD).replaceAll("\\p{M}", "");
        String slug = ascii.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-+|-+$)", "");
        if (slug.isEmpty()) {
            throw ApiException.badRequest("INVALID_NAME", "The English name needs at least one letter or number.");
        }
        return slug.length() > 100 ? slug.substring(0, 100) : slug;
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s.trim();
    }
}
