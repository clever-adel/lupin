package store.lupinwear.catalog.application;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import store.lupinwear.catalog.api.CatalogDtos.CategoryView;
import store.lupinwear.catalog.api.CatalogDtos.ColorDot;
import store.lupinwear.catalog.api.CatalogDtos.ColorView;
import store.lupinwear.catalog.api.CatalogDtos.Crumb;
import store.lupinwear.catalog.api.CatalogDtos.DepartmentView;
import store.lupinwear.catalog.api.CatalogDtos.Facets;
import store.lupinwear.catalog.api.CatalogDtos.ImageView;
import store.lupinwear.catalog.api.CatalogDtos.ProductCard;
import store.lupinwear.catalog.api.CatalogDtos.ProductDetail;
import store.lupinwear.catalog.api.CatalogDtos.VariantLine;
import store.lupinwear.catalog.api.CatalogDtos.VariantView;
import store.lupinwear.shared.ApiException;
import store.lupinwear.shared.PageResponse;

/**
 * Storefront read models. Plain SQL on purpose: a listing page is three queries no matter how many
 * products it shows. Every value reaches the database as a bind parameter.
 */
@Service
@Transactional(readOnly = true)
public class CatalogQueryService {

    /** The most one customer can put in one bag line; also caps how much stock a response reveals. */
    public static final int MAX_LINE_QUANTITY = 10;

    /** What makes a product visible to shoppers. Used by every public query. */
    private static final String VISIBLE = """
            from products p
            join departments d on d.id = p.department_id
            join categories c on c.id = p.category_id
            where p.status = 'ACTIVE' and p.deleted_at is null and d.status = 'ACTIVE' and c.active
            """;
    private static final String IN_STOCK = """
            exists (select 1 from product_variants v join inventory i on i.variant_id = v.id
                    where v.product_id = p.id and v.active and i.on_hand - i.reserved > 0)""";

    public enum Sort {
        FEATURED("p.featured desc, p.published_at desc nulls last, p.id desc"),
        NEWEST("p.published_at desc nulls last, p.id desc"),
        PRICE_ASC("coalesce(p.sale_price, p.price) asc, p.id"),
        PRICE_DESC("coalesce(p.sale_price, p.price) desc, p.id");

        private final String orderBy;

        Sort(String orderBy) {
            this.orderBy = orderBy;
        }

        public static Sort parse(String raw) {
            try {
                return raw == null ? FEATURED : valueOf(raw.trim().toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException e) {
                return FEATURED;
            }
        }
    }

    public record ProductFilter(String department, String category, String query, List<String> sizes,
            List<String> colors, BigDecimal minPrice, BigDecimal maxPrice, boolean saleOnly, boolean inStockOnly,
            Sort sort, int page, int pageSize) {
    }

    private final JdbcClient jdbc;

    public CatalogQueryService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** What the storefront lists: open and coming-soon departments; hidden ones are left out entirely. */
    public List<DepartmentView> departments() {
        return departments(false);
    }

    /** Staff view: every department, hidden ones too, so a hidden department can be shown again. */
    public List<DepartmentView> allDepartments() {
        return departments(true);
    }

    private List<DepartmentView> departments(boolean includeHidden) {
        Map<Integer, List<CategoryView>> categories = new HashMap<>();
        jdbc.sql("""
                select c.department_id, c.slug, c.name_en, c.name_ar, parent.slug as parent_slug
                from categories c left join categories parent on parent.id = c.parent_id
                where c.active order by c.sort_order, c.id
                """).query((rs, n) -> {
                    categories.computeIfAbsent(rs.getInt("department_id"), k -> new ArrayList<>())
                            .add(new CategoryView(rs.getString("slug"), rs.getString("name_en"),
                                    rs.getString("name_ar"), rs.getString("parent_slug")));
                    return null;
                }).list();
        return jdbc.sql("""
                select d.id, d.slug, d.name_en, d.name_ar, d.status,
                       (select count(*) from products p join categories c on c.id = p.category_id
                         where p.department_id = d.id and p.status = 'ACTIVE' and p.deleted_at is null and c.active) as product_count
                from departments d where :all or d.status in ('ACTIVE', 'COMING_SOON') order by d.sort_order, d.id
                """).param("all", includeHidden).query((rs, n) -> new DepartmentView(rs.getString("slug"), rs.getString("name_en"),
                        rs.getString("name_ar"), rs.getString("status"),
                        "ACTIVE".equals(rs.getString("status")) ? rs.getLong("product_count") : 0,
                        categories.getOrDefault(rs.getInt("id"), List.of())))
                .list();
    }

    public PageResponse<ProductCard> search(ProductFilter f) {
        int size = Math.clamp(f.pageSize(), 1, 48);
        int page = Math.max(f.page(), 0);
        Map<String, Object> params = new HashMap<>();
        StringBuilder where = new StringBuilder(VISIBLE);

        if (hasText(f.department())) {
            where.append(" and d.slug = :department");
            params.put("department", f.department());
        }
        if (hasText(f.category())) {
            where.append(" and (c.slug = :category or c.parent_id in"
                    + " (select pc.id from categories pc where pc.slug = :category and pc.department_id = d.id))");
            params.put("category", f.category());
        }
        if (hasText(f.query())) {
            where.append(" and (p.name_en ilike :q escape '\\' or p.name_ar ilike :q escape '\\')");
            params.put("q", "%" + f.query().trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
        }
        if (f.sizes() != null && !f.sizes().isEmpty()) {
            where.append("""
                     and exists (select 1 from product_variants v join sizes s on s.id = v.size_id
                                 join inventory i on i.variant_id = v.id
                                 where v.product_id = p.id and v.active and s.code in (:sizes)
                                   and i.on_hand - i.reserved > 0)""");
            params.put("sizes", f.sizes());
        }
        if (f.colors() != null && !f.colors().isEmpty()) {
            where.append(" and exists (select 1 from product_colors fc where fc.product_id = p.id"
                    + " and lower(fc.name_en) in (:colors))");
            params.put("colors", f.colors().stream().map(s -> s.toLowerCase(Locale.ROOT)).toList());
        }
        if (f.minPrice() != null) {
            where.append(" and coalesce(p.sale_price, p.price) >= :minPrice");
            params.put("minPrice", f.minPrice());
        }
        if (f.maxPrice() != null) {
            where.append(" and coalesce(p.sale_price, p.price) <= :maxPrice");
            params.put("maxPrice", f.maxPrice());
        }
        if (f.saleOnly()) {
            where.append(" and p.sale_price is not null");
        }
        if (f.inStockOnly()) {
            where.append(" and ").append(IN_STOCK);
        }

        long total = jdbc.sql("select count(*) " + where).params(params).query(Long.class).single();
        if (total == 0) {
            return PageResponse.of(List.of(), page, size, 0);
        }

        record Row(long id, String slug, String nameEn, String nameAr, String catEn, String catAr, BigDecimal price,
                BigDecimal salePrice, String badge, boolean inStock) {
        }
        params.put("limit", size);
        params.put("offset", (long) page * size);
        List<Row> rows = jdbc.sql("select p.id, p.slug, p.name_en, p.name_ar, c.name_en as cat_en, c.name_ar as cat_ar,"
                + " p.price, p.sale_price, p.badge, " + IN_STOCK + " as in_stock " + where
                + " order by " + f.sort().orderBy + " limit :limit offset :offset")
                .params(params)
                .query((rs, n) -> new Row(rs.getLong("id"), rs.getString("slug"), rs.getString("name_en"),
                        rs.getString("name_ar"), rs.getString("cat_en"), rs.getString("cat_ar"),
                        rs.getBigDecimal("price"), rs.getBigDecimal("sale_price"), rs.getString("badge"),
                        rs.getBoolean("in_stock")))
                .list();

        Map<Long, List<ColorDot>> dots = new HashMap<>();
        jdbc.sql("""
                select pc.product_id, pc.name_en, pc.name_ar, pc.hex,
                       (select pi.url from product_images pi where pi.color_id = pc.id order by pi.position limit 1) as image_url,
                       (select pi.url from product_images pi where pi.color_id = pc.id order by pi.position offset 1 limit 1) as hover_url
                from product_colors pc where pc.product_id in (:ids)
                order by pc.product_id, pc.is_main desc, pc.sort_order, pc.id
                """).param("ids", rows.stream().map(Row::id).toList())
                .query((rs, n) -> {
                    dots.computeIfAbsent(rs.getLong("product_id"), k -> new ArrayList<>())
                            .add(new ColorDot(rs.getString("name_en"), rs.getString("name_ar"), rs.getString("hex"),
                                    rs.getString("image_url"), rs.getString("hover_url")));
                    return null;
                }).list();

        List<ProductCard> cards = rows.stream().map(r -> new ProductCard(r.slug(), r.nameEn(), r.nameAr(), r.catEn(),
                r.catAr(), r.price(), r.salePrice(), discountPercent(r.price(), r.salePrice()), r.badge(),
                r.inStock(), dots.getOrDefault(r.id(), List.of()))).toList();
        return PageResponse.of(cards, page, size, total);
    }

    public Facets facets(String department) {
        Map<String, Object> params = new HashMap<>();
        String scope = VISIBLE;
        if (hasText(department)) {
            scope += " and d.slug = :department";
            params.put("department", department);
        }
        List<String> sizes = jdbc.sql("select s.code from sizes s where s.id in (select v.size_id from product_variants v"
                + " where v.active and v.product_id in (select p.id " + scope + ")) order by s.size_group, s.sort_order")
                .params(params).query(String.class).list();
        List<ColorDot> colors = jdbc.sql("select min(pc.name_en) as name_en, min(pc.name_ar) as name_ar, min(pc.hex) as hex"
                + " from product_colors pc where pc.product_id in (select p.id " + scope + ")"
                + " group by lower(pc.name_en) order by 1")
                .params(params)
                .query((rs, n) -> new ColorDot(rs.getString("name_en"), rs.getString("name_ar"), rs.getString("hex"), null, null))
                .list();
        return jdbc.sql("select min(coalesce(p.sale_price, p.price)) as lo, max(coalesce(p.sale_price, p.price)) as hi " + scope)
                .params(params)
                .query((rs, n) -> new Facets(sizes, colors, rs.getBigDecimal("lo"), rs.getBigDecimal("hi")))
                .single();
    }

    public ProductDetail product(String slug) {
        record Head(long id, ProductDetail partial) {
        }
        Head head = jdbc.sql("select p.*, d.slug as d_slug, d.name_en as d_en, d.name_ar as d_ar,"
                + " c.slug as c_slug, c.name_en as c_en, c.name_ar as c_ar " + VISIBLE + " and p.slug = :slug")
                .param("slug", slug)
                .query((rs, n) -> new Head(rs.getLong("id"), new ProductDetail(rs.getLong("id"), rs.getString("slug"),
                        rs.getString("name_en"), rs.getString("name_ar"), rs.getString("description_en"),
                        rs.getString("description_ar"), rs.getString("fabric_en"), rs.getString("fabric_ar"),
                        rs.getString("fit_en"), rs.getString("fit_ar"), rs.getString("brand"), rs.getString("badge"),
                        rs.getBigDecimal("price"), rs.getBigDecimal("sale_price"),
                        discountPercent(rs.getBigDecimal("price"), rs.getBigDecimal("sale_price")),
                        new Crumb(rs.getString("d_slug"), rs.getString("d_en"), rs.getString("d_ar")),
                        new Crumb(rs.getString("c_slug"), rs.getString("c_en"), rs.getString("c_ar")), null)))
                .optional()
                .orElseThrow(() -> ApiException.notFound("Product"));

        Map<Long, List<ImageView>> images = new HashMap<>();
        jdbc.sql("""
                select pi.color_id, pi.url, pi.alt_en, pi.alt_ar, pi.width, pi.height
                from product_images pi join product_colors pc on pc.id = pi.color_id
                where pc.product_id = :id order by pi.color_id, pi.position
                """).param("id", head.id())
                .query((rs, n) -> {
                    images.computeIfAbsent(rs.getLong("color_id"), k -> new ArrayList<>())
                            .add(new ImageView(rs.getString("url"), rs.getString("alt_en"), rs.getString("alt_ar"),
                                    (Integer) rs.getObject("width"), (Integer) rs.getObject("height")));
                    return null;
                }).list();

        Map<Long, List<VariantView>> variants = new HashMap<>();
        jdbc.sql("""
                select v.id, v.color_id, s.code, greatest(i.on_hand - i.reserved, 0) as available
                from product_variants v join sizes s on s.id = v.size_id join inventory i on i.variant_id = v.id
                where v.product_id = :id and v.active order by v.color_id, s.sort_order
                """).param("id", head.id())
                .query((rs, n) -> {
                    int available = rs.getInt("available");
                    variants.computeIfAbsent(rs.getLong("color_id"), k -> new ArrayList<>())
                            .add(new VariantView(rs.getLong("id"), rs.getString("code"), available > 0,
                                    Math.min(available, MAX_LINE_QUANTITY)));
                    return null;
                }).list();

        Map<Long, ColorView> colors = new LinkedHashMap<>();
        jdbc.sql("select id, name_en, name_ar, hex, is_main from product_colors where product_id = :id"
                + " order by is_main desc, sort_order, id")
                .param("id", head.id())
                .query((rs, n) -> colors.put(rs.getLong("id"), new ColorView(rs.getLong("id"), rs.getString("name_en"),
                        rs.getString("name_ar"), rs.getString("hex"), rs.getBoolean("is_main"),
                        images.getOrDefault(rs.getLong("id"), List.of()),
                        variants.getOrDefault(rs.getLong("id"), List.of()))))
                .list();

        ProductDetail p = head.partial();
        return new ProductDetail(p.id(), p.slug(), p.nameEn(), p.nameAr(), p.descriptionEn(), p.descriptionAr(),
                p.fabricEn(), p.fabricAr(), p.fitEn(), p.fitAr(), p.brand(), p.badge(), p.price(), p.salePrice(),
                p.discountPercent(), p.department(), p.category(), List.copyOf(colors.values()));
    }

    /** Variants that are no longer purchasable are simply absent from the result. */
    public List<VariantLine> variants(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        return jdbc.sql("select v.id, p.slug, p.name_en, p.name_ar, pc.name_en as color_en, pc.name_ar as color_ar,"
                + " s.code, coalesce(p.sale_price, p.price) as unit_price,"
                + " greatest(i.on_hand - i.reserved, 0) as available,"
                + " (select pi.url from product_images pi where pi.color_id = pc.id order by pi.position limit 1) as image_url"
                + " from product_variants v join product_colors pc on pc.id = v.color_id join sizes s on s.id = v.size_id"
                + " join inventory i on i.variant_id = v.id join products p on p.id = v.product_id"
                + " join departments d on d.id = p.department_id join categories c on c.id = p.category_id"
                + " where p.status = 'ACTIVE' and p.deleted_at is null and d.status = 'ACTIVE' and c.active"
                + " and v.active and v.id in (:ids) order by v.id")
                .param("ids", ids.stream().distinct().limit(50).toList())
                .query((rs, n) -> new VariantLine(rs.getLong("id"), rs.getString("slug"), rs.getString("name_en"),
                        rs.getString("name_ar"), rs.getString("color_en"), rs.getString("color_ar"),
                        rs.getString("code"), rs.getString("image_url"), rs.getBigDecimal("unit_price"),
                        rs.getInt("available") > 0, Math.min(rs.getInt("available"), MAX_LINE_QUANTITY)))
                .list();
    }

    static Integer discountPercent(BigDecimal price, BigDecimal salePrice) {
        if (salePrice == null || price == null || price.signum() <= 0) {
            return null;
        }
        return price.subtract(salePrice).multiply(BigDecimal.valueOf(100))
                .divide(price, 0, RoundingMode.HALF_UP).intValue();
    }

    private static boolean hasText(String s) {
        return s != null && !s.isBlank();
    }
}
