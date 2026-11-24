package store.lupinwear.shop;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import store.lupinwear.audit.AuditLog;
import store.lupinwear.shared.ApiException;
import store.lupinwear.shared.PageResponse;
import store.lupinwear.shop.ShopDtos.LineRequest;
import store.lupinwear.shop.ShopDtos.Piece;
import store.lupinwear.shop.ShopDtos.Receipt;
import store.lupinwear.shop.ShopDtos.ReceiptLine;
import store.lupinwear.shop.ShopDtos.ReturnRequest;
import store.lupinwear.shop.ShopDtos.SaleRequest;
import store.lupinwear.shop.ShopDtos.ShopSummary;
import store.lupinwear.shop.ShopDtos.Totals;

/**
 * Sales and returns at the shop counter. The price is whatever staff type in, not the online price.
 * A sale takes its pieces out of the shared stock in the same transaction, and never more than is free
 * (pieces reserved for open online orders stay put). A return puts them back.
 */
@Service
@Transactional
public class ShopService {

    static final Set<String> PAYMENT_METHODS = Set.of("CASH", "CARD", "INSTAPAY", "WALLET");
    /** Days and months are counted on Cairo's clock, which is where the shop is. */
    private static final String CAIRO = "'Africa/Cairo'";

    private final JdbcClient jdbc;
    private final AuditLog audit;

    public ShopService(JdbcClient jdbc, AuditLog audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    /**
     * Pieces staff can pick from: by product name (English or Arabic) or SKU. Newest products first. Hidden
     * and archived products are included, since the shop may still have them on the rail; removed sizes are not.
     */
    @Transactional(readOnly = true)
    public List<Piece> pieces(String query) {
        Map<String, Object> params = new HashMap<>();
        String where = "";
        String q = query == null ? "" : query.trim();
        if (!q.isEmpty()) {
            q = q.substring(0, Math.min(q.length(), 80));
            where = " and (p.name_en ilike :q escape '\\' or p.name_ar ilike :q escape '\\' or v.sku ilike :q escape '\\')";
            params.put("q", "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
        }
        return jdbc.sql("""
                select v.id, p.id as product_id, p.name_en, p.name_ar, pc.name_en as color, pc.hex, s.code, v.sku,
                       coalesce(p.sale_price, p.price) as price, i.on_hand, i.reserved, p.status,
                       (select pi.url from product_images pi where pi.color_id = pc.id order by pi.position limit 1) as image
                from product_variants v
                join products p on p.id = v.product_id
                join product_colors pc on pc.id = v.color_id
                join sizes s on s.id = v.size_id
                join inventory i on i.variant_id = v.id
                where p.deleted_at is null and v.active
                """ + where + """
                 order by p.id desc, pc.sort_order, pc.id, s.sort_order limit 120
                """)
                .params(params)
                .query((rs, n) -> new Piece(rs.getLong("id"), rs.getLong("product_id"), rs.getString("name_en"),
                        rs.getString("name_ar"), rs.getString("color"), rs.getString("hex"), rs.getString("code"),
                        rs.getString("sku"), rs.getBigDecimal("price"), rs.getInt("on_hand") - rs.getInt("reserved"),
                        rs.getString("status"), rs.getString("image")))
                .list();
    }

    public Receipt sell(UUID actor, SaleRequest req) {
        String method = method(req.paymentMethod());
        List<LineRequest> lines = req.items();
        if (lines.stream().anyMatch(l -> l.variantId() == null)) {
            throw ApiException.badRequest("PIECE_REQUIRED", "Choose a piece for every line.");
        }
        long saleId = insertReceipt("SALE", null, method, total(lines), req.customerName(), req.customerPhone(),
                req.note(), actor);
        // Same order every time, so two tills selling the same pieces cannot deadlock.
        for (LineRequest line : lines.stream().sorted(Comparator.comparing(LineRequest::variantId)).toList()) {
            Snapshot piece = snapshot(line.variantId());
            int taken = jdbc.sql("""
                    update inventory set on_hand = on_hand - :q, updated_at = now()
                    where variant_id = :v and on_hand - :q >= reserved
                    """).param("q", line.quantity()).param("v", line.variantId()).update();
            if (taken == 0) {
                int free = jdbc.sql("select on_hand - reserved from inventory where variant_id = :v")
                        .param("v", line.variantId()).query(Integer.class).optional().orElse(0);
                throw ApiException.conflict("NOT_ENOUGH_STOCK", "Only %d left of %s · %s · %s."
                        .formatted(Math.max(free, 0), piece.productName(), piece.color(), piece.sizeCode()));
            }
            insertLine(saleId, line.variantId(), null, piece, line.quantity(), line.unitPrice());
            movement(line.variantId(), "ADJUST", -line.quantity(), "SHOP_SALE", saleId, "Sold at the shop", actor);
        }
        audit.record(actor, "SHOP_SALE", "shop_sale", saleId, Map.of("total", total(lines), "method", method));
        return receipt(saleId);
    }

    /**
     * A return either points at lines of an earlier shop receipt (never more back than was sold on it), or
     * names pieces directly, for something sold before the shop was on the dashboard. Either way the pieces
     * go back into stock and the money given back is what staff type in.
     */
    public Receipt giveBack(UUID actor, ReturnRequest req) {
        String method = method(req.paymentMethod());
        Long originalSaleId = req.originalSaleId();
        if (originalSaleId != null) {
            String kind = jdbc.sql("select kind from shop_sales where id = :id for update").param("id", originalSaleId)
                    .query(String.class).optional().orElseThrow(() -> ApiException.notFound("Receipt"));
            if (!"SALE".equals(kind)) {
                throw ApiException.badRequest("NOT_A_SALE", "Only a sale can be returned.");
            }
        }
        List<LineRequest> lines = req.items();
        long returnId = insertReceipt("RETURN", originalSaleId, method, total(lines), null, null, req.note(), actor);
        for (LineRequest line : lines) {
            Long variantId;
            Snapshot piece;
            if (line.originalItemId() != null) {
                if (originalSaleId == null) {
                    throw ApiException.badRequest("RECEIPT_REQUIRED", "Say which receipt the pieces come back from.");
                }
                OriginalLine sold = jdbc.sql("""
                        select it.variant_id, it.product_id, it.product_name, it.color, it.size_code, it.sku, it.quantity,
                               coalesce((select sum(r.quantity) from shop_sale_items r where r.original_item_id = it.id), 0)
                        from shop_sale_items it where it.id = :id and it.sale_id = :sale
                        """).param("id", line.originalItemId()).param("sale", originalSaleId)
                        .query((rs, n) -> new OriginalLine((Long) rs.getObject(1),
                                new Snapshot((Long) rs.getObject(2), rs.getString(3), rs.getString(4), rs.getString(5),
                                        rs.getString(6)), rs.getInt(7), rs.getInt(8)))
                        .optional().orElseThrow(() -> ApiException.notFound("Receipt line"));
                if (sold.returned() + line.quantity() > sold.quantity()) {
                    throw ApiException.conflict("RETURN_TOO_MANY", "Only %d of %s · %s · %s can still come back."
                            .formatted(sold.quantity() - sold.returned(), sold.piece().productName(),
                                    sold.piece().color(), sold.piece().sizeCode()));
                }
                variantId = sold.variantId();
                piece = sold.piece();
            } else {
                if (line.variantId() == null) {
                    throw ApiException.badRequest("PIECE_REQUIRED", "Choose a piece for every line.");
                }
                variantId = line.variantId();
                piece = snapshot(variantId);
            }
            insertLine(returnId, variantId, line.originalItemId(), piece, line.quantity(), line.unitPrice());
            // A piece whose product was deleted since cannot go back into stock; the money still counts.
            if (variantId != null && jdbc.sql("""
                    update inventory set on_hand = on_hand + :q, updated_at = now() where variant_id = :v
                    """).param("q", line.quantity()).param("v", variantId).update() > 0) {
                movement(variantId, "RETURN", line.quantity(), "SHOP_RETURN", returnId, "Returned at the shop", actor);
            }
        }
        audit.record(actor, "SHOP_RETURN", "shop_sale", returnId,
                Map.of("total", total(lines), "originalSaleId", originalSaleId == null ? "" : originalSaleId));
        return receipt(returnId);
    }

    @Transactional(readOnly = true)
    public Receipt receipt(long id) {
        PageResponse<Receipt> one = list(null, null, id, 0, 1);
        if (one.items().isEmpty()) {
            throw ApiException.notFound("Receipt");
        }
        return one.items().get(0);
    }

    /** Receipts newest first; {@code day} is a Cairo date (yyyy-MM-dd), {@code kind} SALE or RETURN. */
    @Transactional(readOnly = true)
    public PageResponse<Receipt> list(String kind, String day, Long id, int page, int pageSize) {
        int size = Math.clamp(pageSize, 1, 100);
        int index = Math.max(page, 0);
        StringBuilder where = new StringBuilder(" from shop_sales s left join users u on u.id = s.actor_user_id where true");
        Map<String, Object> params = new HashMap<>();
        if (id != null) {
            where.append(" and s.id = :id");
            params.put("id", id);
        }
        if ("SALE".equals(kind) || "RETURN".equals(kind)) {
            where.append(" and s.kind = :kind");
            params.put("kind", kind);
        }
        if (day != null && day.matches("\\d{4}-\\d{2}-\\d{2}")) {
            where.append(" and (s.created_at at time zone " + CAIRO + ")::date = cast(:day as date)");
            params.put("day", day);
        }
        long total = jdbc.sql("select count(*)" + where).params(params).query(Long.class).single();
        if (total == 0) {
            return PageResponse.of(List.of(), index, size, 0);
        }
        params.put("limit", size);
        params.put("offset", (long) index * size);
        record Head(long id, String kind, Long originalSaleId, String method, BigDecimal total, String customerName,
                String customerPhone, String note, String staff, Instant at) {
        }
        List<Head> heads = jdbc.sql("""
                select s.id, s.kind, s.original_sale_id, s.payment_method, s.total, s.customer_name, s.customer_phone,
                       s.note, u.full_name, s.created_at
                """ + where + " order by s.created_at desc, s.id desc limit :limit offset :offset")
                .params(params)
                .query((rs, n) -> new Head(rs.getLong(1), rs.getString(2), (Long) rs.getObject(3), rs.getString(4),
                        rs.getBigDecimal(5), rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9),
                        rs.getObject(10, OffsetDateTime.class).toInstant()))
                .list();
        Map<Long, List<ReceiptLine>> lines = new LinkedHashMap<>();
        jdbc.sql("""
                select it.sale_id, it.id, it.variant_id, it.product_id, it.product_name, it.color, it.size_code, it.sku,
                       it.quantity, it.unit_price, it.original_item_id,
                       coalesce((select sum(r.quantity) from shop_sale_items r where r.original_item_id = it.id), 0),
                       (select pi.url from product_variants v join product_images pi on pi.color_id = v.color_id
                        where v.id = it.variant_id order by pi.position limit 1)
                from shop_sale_items it where it.sale_id in (:ids) order by it.id
                """).param("ids", heads.stream().map(Head::id).toList())
                .query((rs, n) -> lines.computeIfAbsent(rs.getLong(1), k -> new ArrayList<>())
                        .add(new ReceiptLine(rs.getLong(2), (Long) rs.getObject(3), (Long) rs.getObject(4),
                                rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8), rs.getInt(9),
                                rs.getBigDecimal(10), (Long) rs.getObject(11), rs.getInt(12), rs.getString(13))))
                .list();
        Map<Long, List<Long>> returns = new HashMap<>();
        jdbc.sql("select original_sale_id, id from shop_sales where original_sale_id in (:ids) order by id")
                .param("ids", heads.stream().map(Head::id).toList())
                .query((rs, n) -> returns.computeIfAbsent(rs.getLong(1), k -> new ArrayList<>()).add(rs.getLong(2)))
                .list();
        return PageResponse.of(heads.stream().map(h -> new Receipt(h.id(), h.kind(), h.originalSaleId(), h.method(),
                h.total(), h.customerName(), h.customerPhone(), h.note(), h.staff(), h.at(),
                lines.getOrDefault(h.id(), List.of()), returns.getOrDefault(h.id(), List.of()))).toList(),
                index, size, total);
    }

    @Transactional(readOnly = true)
    public ShopSummary summary() {
        return new ShopSummary(totals("(s.created_at at time zone " + CAIRO + ")::date = (now() at time zone " + CAIRO + ")::date"),
                totals("date_trunc('month', s.created_at at time zone " + CAIRO + ") = date_trunc('month', now() at time zone " + CAIRO + ")"));
    }

    private Totals totals(String period) {
        return jdbc.sql("""
                select coalesce(sum(s.total) filter (where s.kind = 'SALE'), 0),
                       coalesce(sum(s.total) filter (where s.kind = 'RETURN'), 0),
                       count(*) filter (where s.kind = 'SALE'),
                       coalesce((select sum(it.quantity) from shop_sale_items it join shop_sales x on x.id = it.sale_id
                                 where x.kind = 'SALE' and %s), 0),
                       coalesce((select sum(it.quantity) from shop_sale_items it join shop_sales x on x.id = it.sale_id
                                 where x.kind = 'RETURN' and %s), 0)
                from shop_sales s where %s
                """.formatted(period.replace("s.created_at", "x.created_at"), period.replace("s.created_at", "x.created_at"),
                        period))
                .query((rs, n) -> new Totals(rs.getBigDecimal(1), rs.getBigDecimal(2),
                        rs.getBigDecimal(1).subtract(rs.getBigDecimal(2)), rs.getInt(3), rs.getInt(4), rs.getInt(5)))
                .single();
    }

    private record Snapshot(Long productId, String productName, String color, String sizeCode, String sku) {
    }

    private record OriginalLine(Long variantId, Snapshot piece, int quantity, int returned) {
    }

    private Snapshot snapshot(long variantId) {
        return jdbc.sql("""
                select p.id, p.name_en, pc.name_en, s.code, v.sku
                from product_variants v join products p on p.id = v.product_id
                join product_colors pc on pc.id = v.color_id join sizes s on s.id = v.size_id
                where v.id = :v and p.deleted_at is null
                """).param("v", variantId)
                .query((rs, n) -> new Snapshot(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5)))
                .optional().orElseThrow(() -> ApiException.notFound("Piece"));
    }

    private long insertReceipt(String kind, Long originalSaleId, String method, BigDecimal total, String name,
            String phone, String note, UUID actor) {
        return jdbc.sql("""
                insert into shop_sales (kind, original_sale_id, payment_method, total, customer_name, customer_phone,
                                        note, actor_user_id)
                values (:kind, :orig, :method, :total, :name, :phone, :note, :actor) returning id
                """).param("kind", kind).param("orig", originalSaleId).param("method", method).param("total", total)
                .param("name", blank(name)).param("phone", blank(phone)).param("note", blank(note))
                .param("actor", actor).query(Long.class).single();
    }

    private void insertLine(long saleId, Long variantId, Long originalItemId, Snapshot piece, int quantity,
            BigDecimal unitPrice) {
        jdbc.sql("""
                insert into shop_sale_items (sale_id, variant_id, original_item_id, product_id, product_name, color,
                                             size_code, sku, quantity, unit_price)
                values (:sale, :v, :orig, :p, :name, :color, :size, :sku, :q, :price)
                """).param("sale", saleId).param("v", variantId).param("orig", originalItemId)
                .param("p", piece.productId()).param("name", piece.productName()).param("color", piece.color())
                .param("size", piece.sizeCode()).param("sku", piece.sku()).param("q", quantity)
                .param("price", unitPrice).update();
    }

    private void movement(long variantId, String type, int quantity, String refType, long refId, String note,
            UUID actor) {
        jdbc.sql("""
                insert into inventory_movements (variant_id, type, quantity, reference_type, reference_id, note,
                                                 actor_user_id)
                values (:v, :t, :q, :rt, :ri, :n, :a)
                """).param("v", variantId).param("t", type).param("q", quantity).param("rt", refType)
                .param("ri", String.valueOf(refId)).param("n", note).param("a", actor).update();
    }

    private static BigDecimal total(List<LineRequest> lines) {
        return lines.stream().map(l -> l.unitPrice().multiply(BigDecimal.valueOf(l.quantity())))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static String method(String value) {
        String method = value == null ? "CASH" : value;
        if (!PAYMENT_METHODS.contains(method)) {
            throw ApiException.badRequest("PAYMENT_METHOD", "Choose cash, card, InstaPay or wallet.");
        }
        return method;
    }

    private static String blank(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
