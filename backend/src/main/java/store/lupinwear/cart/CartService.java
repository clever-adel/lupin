package store.lupinwear.cart;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import store.lupinwear.catalog.api.CatalogDtos.VariantLine;
import store.lupinwear.catalog.application.CatalogQueryService;
import store.lupinwear.shared.ApiException;

/** The signed-in customer's bag. It stores variant ids and quantities only; prices are read fresh every time. */
@Service
@Transactional
public class CartService {

    public static final int MAX_LINES = 50;

    /** A bag line with everything pricing and ordering need. Never serialised as is. */
    public record Line(long variantId, long productId, String productSlug, String nameEn, String nameAr,
            String colorEn, String colorAr, String sizeCode, String sku, String imageUrl, BigDecimal unitPrice,
            int quantity, boolean purchasable, int available, int departmentId, int categoryId,
            Integer collectionId) {

        public BigDecimal lineTotal() {
            return unitPrice.multiply(BigDecimal.valueOf(quantity));
        }

        public boolean orderable() {
            return purchasable && quantity <= available;
        }

        public LineView view() {
            return new LineView(variantId, productSlug, nameEn, nameAr, colorEn, colorAr, sizeCode, imageUrl,
                    unitPrice, quantity, lineTotal(), purchasable,
                    purchasable ? Math.min(available, CatalogQueryService.MAX_LINE_QUANTITY) : 0);
        }
    }

    public record LineView(long variantId, String productSlug, String nameEn, String nameAr, String colorEn,
            String colorAr, String sizeCode, String imageUrl, BigDecimal unitPrice, int quantity,
            BigDecimal lineTotal, boolean purchasable, int maxQuantity) {
    }

    public record CartView(List<LineView> lines, int count, BigDecimal subtotal) {
    }

    public record GuestItem(long variantId, int quantity) {
    }

    private final JdbcClient jdbc;
    private final CatalogQueryService catalog;

    public CartService(JdbcClient jdbc, CatalogQueryService catalog) {
        this.jdbc = jdbc;
        this.catalog = catalog;
    }

    @Transactional(readOnly = true)
    public List<Line> lines(UUID user) {
        return jdbc.sql("""
                select ci.variant_id, ci.quantity, p.id as product_id, p.slug, p.name_en, p.name_ar,
                       pc.name_en as color_en, pc.name_ar as color_ar, s.code, v.sku,
                       coalesce(p.sale_price, p.price) as unit_price,
                       greatest(i.on_hand - i.reserved, 0) as available,
                       (p.status = 'ACTIVE' and p.deleted_at is null and d.status = 'ACTIVE' and c.active and v.active) as purchasable,
                       p.department_id, p.category_id, p.collection_id,
                       (select pi.url from product_images pi where pi.color_id = pc.id order by pi.position limit 1) as image_url
                from carts ct
                join cart_items ci on ci.cart_id = ct.id
                join product_variants v on v.id = ci.variant_id
                join products p on p.id = v.product_id
                join product_colors pc on pc.id = v.color_id
                join sizes s on s.id = v.size_id
                join inventory i on i.variant_id = v.id
                join departments d on d.id = p.department_id
                join categories c on c.id = p.category_id
                where ct.user_id = :u
                order by ci.added_at, ci.id
                """).param("u", user)
                .query((rs, n) -> new Line(rs.getLong("variant_id"), rs.getLong("product_id"), rs.getString("slug"),
                        rs.getString("name_en"), rs.getString("name_ar"), rs.getString("color_en"),
                        rs.getString("color_ar"), rs.getString("code"), rs.getString("sku"),
                        rs.getString("image_url"), rs.getBigDecimal("unit_price"), rs.getInt("quantity"),
                        rs.getBoolean("purchasable"), rs.getInt("available"), rs.getInt("department_id"),
                        rs.getInt("category_id"), (Integer) rs.getObject("collection_id")))
                .list();
    }

    @Transactional(readOnly = true)
    public CartView view(UUID user) {
        return view(lines(user));
    }

    public static CartView view(List<Line> lines) {
        return new CartView(lines.stream().map(Line::view).toList(),
                lines.stream().mapToInt(Line::quantity).sum(), subtotal(lines));
    }

    /** Lines that can no longer be bought do not count towards the subtotal. */
    public static BigDecimal subtotal(List<Line> lines) {
        return lines.stream().filter(Line::purchasable).map(Line::lineTotal)
                .reduce(BigDecimal.ZERO, BigDecimal::add).setScale(2);
    }

    public CartView setQuantity(UUID user, long variantId, int quantity) {
        VariantLine variant = catalog.variants(List.of(variantId)).stream().findFirst()
                .orElseThrow(() -> ApiException.conflict("UNAVAILABLE", "This item is no longer available."));
        if (quantity > variant.maxQuantity()) {
            throw ApiException.conflict("INSUFFICIENT_STOCK", variant.maxQuantity() == 0
                    ? "This size is sold out."
                    : "Only " + variant.maxQuantity() + " available for this size.");
        }
        UUID cart = cartId(user);
        boolean isNewLine = jdbc.sql("select count(*) from cart_items where cart_id = :c and variant_id = :v")
                .param("c", cart).param("v", variantId).query(Long.class).single() == 0;
        if (isNewLine && lineCount(cart) >= MAX_LINES) {
            throw ApiException.conflict("BAG_FULL", "Your bag is full. Remove an item to add another.");
        }
        upsert(cart, variantId, quantity);
        return view(user);
    }

    public CartView remove(UUID user, long variantId) {
        jdbc.sql("delete from cart_items where variant_id = :v and cart_id in (select id from carts where user_id = :u)")
                .param("v", variantId).param("u", user).update();
        return view(user);
    }

    public void clear(UUID user) {
        jdbc.sql("delete from cart_items where cart_id in (select id from carts where user_id = :u)")
                .param("u", user).update();
    }

    /**
     * Folds a guest bag into the account's bag after sign-in. Quantities add up, capped by the per-line
     * limit and by stock. Items that cannot be bought any more are dropped without failing the sign-in.
     */
    public CartView merge(UUID user, List<GuestItem> items) {
        Map<Long, Integer> wanted = items.stream().filter(i -> i.quantity() > 0).limit(MAX_LINES)
                .collect(Collectors.toMap(GuestItem::variantId, GuestItem::quantity, Integer::sum));
        if (wanted.isEmpty()) {
            return view(user);
        }
        UUID cart = cartId(user);
        Map<Long, Integer> existing = lines(user).stream().collect(Collectors.toMap(Line::variantId, Line::quantity));
        long lineCount = existing.size();
        for (VariantLine variant : catalog.variants(List.copyOf(wanted.keySet()))) {
            int current = existing.getOrDefault(variant.variantId(), 0);
            int quantity = Math.min(current + wanted.get(variant.variantId()), variant.maxQuantity());
            if (quantity < 1 || (current == 0 && lineCount >= MAX_LINES)) {
                continue;
            }
            if (current == 0) {
                lineCount++;
            }
            upsert(cart, variant.variantId(), quantity);
        }
        return view(user);
    }

    private void upsert(UUID cart, long variantId, int quantity) {
        jdbc.sql("""
                insert into cart_items (cart_id, variant_id, quantity) values (:c, :v, :q)
                on conflict (cart_id, variant_id) do update set quantity = excluded.quantity
                """).param("c", cart).param("v", variantId).param("q", quantity).update();
    }

    private UUID cartId(UUID user) {
        return jdbc.sql("""
                insert into carts (user_id) values (:u)
                on conflict (user_id) do update set updated_at = now() returning id
                """).param("u", user).query(UUID.class).single();
    }

    private long lineCount(UUID cart) {
        return jdbc.sql("select count(*) from cart_items where cart_id = :c").param("c", cart)
                .query(Long.class).single();
    }
}
