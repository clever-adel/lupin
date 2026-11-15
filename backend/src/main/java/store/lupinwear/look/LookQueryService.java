package store.lupinwear.look;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import store.lupinwear.catalog.api.CatalogDtos.ProductCard;
import store.lupinwear.catalog.api.CatalogDtos.VariantView;
import store.lupinwear.catalog.application.CatalogQueryService;
import store.lupinwear.look.LookDtos.LookCard;
import store.lupinwear.look.LookDtos.LookColor;
import store.lupinwear.look.LookDtos.LookDetail;
import store.lupinwear.look.LookDtos.LookItem;
import store.lupinwear.shared.ApiException;

/**
 * Looks as shoppers see them. Every name, price and stock figure is read live from the catalogue; an
 * item whose product is hidden from shoppers is left out, and a look with no visible item is not shown.
 */
@Service
@Transactional(readOnly = true)
public class LookQueryService {

    /** Same visibility rule as the catalogue: active product in an open department and active category. */
    private static final String VISIBLE_PRODUCT = """
            p.status = 'ACTIVE' and p.deleted_at is null
            and exists (select 1 from departments d where d.id = p.department_id and d.status = 'ACTIVE')
            and exists (select 1 from categories c where c.id = p.category_id and c.active)""";

    private static final int MAX_OTHER_LOOKS = 6;
    private static final int MAX_PAIRS = 4;

    private final JdbcClient jdbc;
    private final CatalogQueryService catalog;

    public LookQueryService(JdbcClient jdbc, CatalogQueryService catalog) {
        this.jdbc = jdbc;
        this.catalog = catalog;
    }

    public List<LookCard> looks() {
        return cards(null, 24);
    }

    /** Looks that include this product, for "seen in" links on a product page. */
    public List<LookCard> looksWithProduct(String productSlug) {
        return cards(productSlug, 4);
    }

    private List<LookCard> cards(String productSlug, int limit) {
        String filter = productSlug == null ? "" : """
                 and exists (select 1 from look_items fi join products fp on fp.id = fi.product_id
                             where fi.look_id = l.id and fp.slug = :slug)""";
        var query = jdbc.sql("""
                select l.slug, l.title_en, l.title_ar, l.image_url, l.image_source,
                       count(*) as item_count, sum(coalesce(p.sale_price, p.price)) as total
                from looks l
                join look_items li on li.look_id = l.id
                join products p on p.id = li.product_id
                where l.status = 'PUBLISHED' and l.image_url is not null and %s%s
                group by l.id
                order by l.sort_order, l.id desc
                limit :limit
                """.formatted(VISIBLE_PRODUCT, filter)).param("limit", limit);
        if (productSlug != null) {
            query = query.param("slug", productSlug);
        }
        return query.query((rs, n) -> new LookCard(rs.getString("slug"), rs.getString("title_en"),
                rs.getString("title_ar"), rs.getString("image_url"), "AI".equals(rs.getString("image_source")),
                rs.getInt("item_count"), rs.getBigDecimal("total"))).list();
    }

    public LookDetail look(String slug) {
        record Head(long id, String slug, String titleEn, String titleAr, String descriptionEn, String descriptionAr,
                String imageUrl, boolean ai) {
        }
        Head head = jdbc.sql("""
                select id, slug, title_en, title_ar, description_en, description_ar, image_url, image_source
                from looks where slug = :slug and status = 'PUBLISHED' and image_url is not null
                """).param("slug", slug)
                .query((rs, n) -> new Head(rs.getLong("id"), rs.getString("slug"), rs.getString("title_en"),
                        rs.getString("title_ar"), rs.getString("description_en"), rs.getString("description_ar"),
                        rs.getString("image_url"), "AI".equals(rs.getString("image_source"))))
                .optional().orElseThrow(() -> ApiException.notFound("Look"));

        record Row(long productId, long colorId, String role, LookItem partial) {
        }
        List<Row> rows = jdbc.sql("""
                select li.product_id, li.color_id, li.role, p.slug, p.name_en, p.name_ar, c.name_en as cat_en,
                       c.name_ar as cat_ar, p.price, p.sale_price, p.description_en, p.description_ar,
                       p.fabric_en, p.fabric_ar, p.fit_en, p.fit_ar
                from look_items li
                join products p on p.id = li.product_id
                join categories c on c.id = p.category_id
                where li.look_id = :look and %s
                order by li.position
                """.formatted(VISIBLE_PRODUCT)).param("look", head.id())
                .query((rs, n) -> new Row(rs.getLong("product_id"), rs.getLong("color_id"), rs.getString("role"),
                        new LookItem(rs.getString("slug"), rs.getString("name_en"), rs.getString("name_ar"),
                                rs.getString("cat_en"), rs.getString("cat_ar"), rs.getString("role"),
                                rs.getBigDecimal("price"), rs.getBigDecimal("sale_price"),
                                discountPercent(rs.getBigDecimal("price"), rs.getBigDecimal("sale_price")),
                                rs.getString("description_en"), rs.getString("description_ar"),
                                rs.getString("fabric_en"), rs.getString("fabric_ar"), rs.getString("fit_en"),
                                rs.getString("fit_ar"), rs.getLong("color_id"), false, null)))
                .list();
        if (rows.isEmpty()) {
            throw ApiException.notFound("Look");
        }

        List<Long> productIds = rows.stream().map(Row::productId).toList();
        Map<Long, List<LookColor>> colors = colors(productIds);

        List<LookItem> items = new ArrayList<>();
        BigDecimal total = BigDecimal.ZERO;
        BigDecimal fullPrice = BigDecimal.ZERO;
        for (Row row : rows) {
            LookItem p = row.partial();
            List<LookColor> productColors = colors.getOrDefault(row.productId(), List.of());
            boolean inStock = productColors.stream().filter(c -> c.id() == row.colorId())
                    .flatMap(c -> c.variants().stream()).anyMatch(VariantView::available);
            items.add(new LookItem(p.productSlug(), p.nameEn(), p.nameAr(), p.categoryEn(), p.categoryAr(), p.role(),
                    p.price(), p.salePrice(), p.discountPercent(), p.descriptionEn(), p.descriptionAr(), p.fabricEn(),
                    p.fabricAr(), p.fitEn(), p.fitAr(), row.colorId(), inStock, productColors));
            total = total.add(p.salePrice() != null ? p.salePrice() : p.price());
            fullPrice = fullPrice.add(p.price());
        }

        List<LookCard> others = looks().stream().filter(l -> !l.slug().equals(head.slug()))
                .limit(MAX_OTHER_LOOKS).toList();
        return new LookDetail(head.slug(), head.titleEn(), head.titleAr(), head.descriptionEn(), head.descriptionAr(),
                head.imageUrl(), head.ai(), items, total, fullPrice, pairsWith(head.id(), productIds), others);
    }

    /** Every colour of the given products with photo and live sizes, main colour first. */
    private Map<Long, List<LookColor>> colors(List<Long> productIds) {
        Map<Long, List<VariantView>> variants = new HashMap<>();
        jdbc.sql("""
                select v.id, v.color_id, s.code, greatest(i.on_hand - i.reserved, 0) as available
                from product_variants v join sizes s on s.id = v.size_id join inventory i on i.variant_id = v.id
                where v.product_id in (:ids) and v.active order by v.color_id, s.sort_order
                """).param("ids", productIds)
                .query((rs, n) -> {
                    int available = rs.getInt("available");
                    variants.computeIfAbsent(rs.getLong("color_id"), k -> new ArrayList<>())
                            .add(new VariantView(rs.getLong("id"), rs.getString("code"), available > 0,
                                    Math.min(available, CatalogQueryService.MAX_LINE_QUANTITY)));
                    return null;
                }).list();
        Map<Long, List<LookColor>> byProduct = new LinkedHashMap<>();
        jdbc.sql("""
                select pc.id, pc.product_id, pc.name_en, pc.name_ar, pc.hex,
                       (select pi.url from product_images pi where pi.color_id = pc.id order by pi.position limit 1) as image_url
                from product_colors pc where pc.product_id in (:ids)
                order by pc.product_id, pc.is_main desc, pc.sort_order, pc.id
                """).param("ids", productIds)
                .query((rs, n) -> {
                    byProduct.computeIfAbsent(rs.getLong("product_id"), k -> new ArrayList<>())
                            .add(new LookColor(rs.getLong("id"), rs.getString("name_en"), rs.getString("name_ar"),
                                    rs.getString("hex"), rs.getString("image_url"),
                                    variants.getOrDefault(rs.getLong("id"), List.of())));
                    return null;
                }).list();
        return byProduct;
    }

    /**
     * Products that complete the look: in stock, from the same departments, in categories the look does
     * not already cover. Products worn in other looks next to these items come first, then featured ones.
     */
    private List<ProductCard> pairsWith(long lookId, List<Long> productIds) {
        List<Long> ids = jdbc.sql("""
                select p.id from products p
                where %s
                  and p.id not in (:items)
                  and p.department_id in (select department_id from products where id in (:items))
                  and p.category_id not in (select category_id from products where id in (:items))
                  and exists (select 1 from product_variants v join inventory i on i.variant_id = v.id
                              where v.product_id = p.id and v.active and i.on_hand - i.reserved > 0)
                order by (select count(*) from look_items o
                          where o.product_id = p.id and o.look_id <> :look
                            and o.look_id in (select look_id from look_items where product_id in (:items))) desc,
                         p.featured desc, p.published_at desc nulls last, p.id desc
                limit :limit
                """.formatted(VISIBLE_PRODUCT))
                .param("items", productIds).param("look", lookId).param("limit", MAX_PAIRS)
                .query(Long.class).list();
        return catalog.cards(ids);
    }

    private static Integer discountPercent(BigDecimal price, BigDecimal salePrice) {
        if (salePrice == null || price == null || price.signum() <= 0) {
            return null;
        }
        return price.subtract(salePrice).multiply(BigDecimal.valueOf(100))
                .divide(price, 0, java.math.RoundingMode.HALF_UP).intValue();
    }
}
