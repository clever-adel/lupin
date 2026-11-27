package store.lupinwear.admin;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.shared.ApiException;

/**
 * Sales for the owner, by Cairo calendar day: online orders and in-store sales, best sellers, sizes and
 * payment methods, plus the online orders of the same days as a spreadsheet (CSV that Excel opens).
 *
 * <p>An online order counts as a sale unless it is cancelled, refunded or still waiting for an online
 * payment. In-store returns are taken off in-store sales.
 */
@RestController
@RequestMapping("/api/v1/admin/reports")
@PreAuthorize("hasRole('OWNER')")
@Transactional(readOnly = true)
public class AdminReportController {

    static final ZoneId CAIRO = ZoneId.of("Africa/Cairo");
    static final int MAX_DAYS = 366;
    private static final String COUNTED = "o.status not in ('CANCELLED', 'REFUNDED', 'AWAITING_PAYMENT')";
    private static final String IN_RANGE = "(o.placed_at at time zone 'Africa/Cairo')::date between :from and :to";
    private static final String SHOP_IN_RANGE = "(s.created_at at time zone 'Africa/Cairo')::date between :from and :to";

    public record Online(long orders, BigDecimal revenue, BigDecimal itemsRevenue, BigDecimal deliveryFees,
            BigDecimal discounts, BigDecimal averageOrder, long cancelled, long items) {
    }

    public record InStore(long sales, long returns, BigDecimal revenue, long items) {
    }

    public record Day(LocalDate date, long orders, BigDecimal onlineRevenue, BigDecimal shopRevenue) {
    }

    public record TopProduct(String name, long quantity, BigDecimal revenue) {
    }

    public record SizeCount(String size, long quantity) {
    }

    public record PaymentMethodRow(String method, long orders, BigDecimal revenue) {
    }

    public record Report(LocalDate from, LocalDate to, BigDecimal totalRevenue, Online online, InStore inStore,
            List<Day> days, List<TopProduct> topProducts, List<SizeCount> sizes, List<PaymentMethodRow> paymentMethods) {
    }

    private final JdbcClient jdbc;
    private final Clock clock;

    public AdminReportController(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** Defaults to the last 30 days, today included. */
    @GetMapping
    public Report report(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate[] range = range(from, to);
        LocalDate start = range[0];
        LocalDate end = range[1];

        Online online = jdbc.sql("select count(*), coalesce(sum(o.total), 0), coalesce(sum(o.subtotal - o.discount_total), 0),"
                        + " coalesce(sum(o.delivery_fee), 0), coalesce(sum(o.discount_total), 0),"
                        + " (select count(*) from orders o where o.status = 'CANCELLED' and " + IN_RANGE + "),"
                        + " (select coalesce(sum(i.quantity), 0) from order_items i join orders o on o.id = i.order_id"
                        + "   where " + COUNTED + " and " + IN_RANGE + ")"
                        + " from orders o where " + COUNTED + " and " + IN_RANGE)
                .param("from", start).param("to", end)
                .query((rs, n) -> {
                    long orders = rs.getLong(1);
                    BigDecimal revenue = rs.getBigDecimal(2);
                    BigDecimal average = orders == 0 ? BigDecimal.ZERO
                            : revenue.divide(BigDecimal.valueOf(orders), 2, RoundingMode.HALF_UP);
                    return new Online(orders, revenue, rs.getBigDecimal(3), rs.getBigDecimal(4), rs.getBigDecimal(5),
                            average, rs.getLong(6), rs.getLong(7));
                }).single();

        InStore inStore = jdbc.sql("select count(*) filter (where s.kind = 'SALE'), count(*) filter (where s.kind = 'RETURN'),"
                        + " coalesce(sum(case when s.kind = 'SALE' then s.total else -s.total end), 0),"
                        + " (select coalesce(sum(case when s.kind = 'SALE' then i.quantity else -i.quantity end), 0)"
                        + "   from shop_sale_items i join shop_sales s on s.id = i.sale_id where " + SHOP_IN_RANGE + ")"
                        + " from shop_sales s where " + SHOP_IN_RANGE)
                .param("from", start).param("to", end)
                .query((rs, n) -> new InStore(rs.getLong(1), rs.getLong(2), rs.getBigDecimal(3), rs.getLong(4))).single();

        Map<LocalDate, Day> byDay = new LinkedHashMap<>();
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            byDay.put(d, new Day(d, 0, BigDecimal.ZERO, BigDecimal.ZERO));
        }
        jdbc.sql("select (o.placed_at at time zone 'Africa/Cairo')::date, count(*), sum(o.total) from orders o"
                        + " where " + COUNTED + " and " + IN_RANGE + " group by 1")
                .param("from", start).param("to", end)
                .query((rs, n) -> {
                    LocalDate d = rs.getObject(1, LocalDate.class);
                    Day old = byDay.get(d);
                    if (old != null) byDay.put(d, new Day(d, rs.getLong(2), rs.getBigDecimal(3), old.shopRevenue()));
                    return d;
                }).list();
        jdbc.sql("select (s.created_at at time zone 'Africa/Cairo')::date,"
                        + " sum(case when s.kind = 'SALE' then s.total else -s.total end) from shop_sales s"
                        + " where " + SHOP_IN_RANGE + " group by 1")
                .param("from", start).param("to", end)
                .query((rs, n) -> {
                    LocalDate d = rs.getObject(1, LocalDate.class);
                    Day old = byDay.get(d);
                    if (old != null) byDay.put(d, new Day(d, old.orders(), old.onlineRevenue(), rs.getBigDecimal(2)));
                    return d;
                }).list();

        // Online and in-store pieces together; an in-store return takes its pieces back off.
        String pieces = "select i.product_name as name, i.size_code as size, i.quantity as qty, i.line_total as amount"
                + " from order_items i join orders o on o.id = i.order_id where " + COUNTED + " and " + IN_RANGE
                + " union all select i.product_name, i.size_code,"
                + " case when s.kind = 'SALE' then i.quantity else -i.quantity end,"
                + " case when s.kind = 'SALE' then i.quantity * i.unit_price else -i.quantity * i.unit_price end"
                + " from shop_sale_items i join shop_sales s on s.id = i.sale_id where " + SHOP_IN_RANGE;
        List<TopProduct> top = jdbc.sql("select name, sum(qty), sum(amount) from (" + pieces + ") p"
                        + " group by name having sum(qty) > 0 order by sum(qty) desc, sum(amount) desc limit 10")
                .param("from", start).param("to", end)
                .query((rs, n) -> new TopProduct(rs.getString(1), rs.getLong(2), rs.getBigDecimal(3))).list();
        List<SizeCount> sizes = jdbc.sql("select size, sum(qty) from (" + pieces + ") p"
                        + " group by size having sum(qty) > 0 order by sum(qty) desc")
                .param("from", start).param("to", end)
                .query((rs, n) -> new SizeCount(rs.getString(1), rs.getLong(2))).list();
        List<PaymentMethodRow> methods = jdbc.sql("select coalesce(o.payment_method, 'UNKNOWN'), count(*), sum(o.total)"
                        + " from orders o where " + COUNTED + " and " + IN_RANGE + " group by 1 order by 3 desc")
                .param("from", start).param("to", end)
                .query((rs, n) -> new PaymentMethodRow(rs.getString(1), rs.getLong(2), rs.getBigDecimal(3))).list();

        return new Report(start, end, online.revenue().add(inStore.revenue()), online, inStore,
                new ArrayList<>(byDay.values()), top, sizes, methods);
    }

    /** The online orders placed on those days (every status), one row each, for Excel. */
    @GetMapping("/orders.csv")
    public ResponseEntity<byte[]> ordersCsv(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate[] range = range(from, to);
        DateTimeFormatter when = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(CAIRO);
        StringBuilder csv = new StringBuilder("﻿"); // lets Excel read the Arabic names correctly
        csv.append(row("Reference", "Placed (Cairo)", "Status", "Payment method", "Payment status", "Customer", "Phone",
                "Governorate", "City", "Address", "Pieces", "Subtotal", "Discount", "Promo code", "Delivery fee", "Total",
                "Courier", "Tracking number"));
        jdbc.sql("""
                select o.reference, o.placed_at, o.status, o.payment_method, o.payment_status, o.customer_name,
                       o.customer_phone, o.governorate_name, o.city, o.address_line,
                       (select coalesce(sum(i.quantity), 0) from order_items i where i.order_id = o.id),
                       o.subtotal, o.discount_total, o.promo_code, o.delivery_fee, o.total,
                       (select s.carrier from shipments s where s.order_id = o.id order by s.id desc limit 1),
                       (select s.tracking_reference from shipments s where s.order_id = o.id order by s.id desc limit 1)
                from orders o where """ + IN_RANGE + " order by o.placed_at")
                .param("from", range[0]).param("to", range[1])
                .query((rs, n) -> csv.append(row(rs.getString(1),
                        when.format(rs.getObject(2, java.time.OffsetDateTime.class)), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9),
                        rs.getString(10), String.valueOf(rs.getLong(11)), plain(rs.getBigDecimal(12)),
                        plain(rs.getBigDecimal(13)), rs.getString(14), plain(rs.getBigDecimal(15)),
                        plain(rs.getBigDecimal(16)), rs.getString(17), rs.getString(18))))
                .list();
        String name = "lupin-orders-" + range[0] + "-to-" + range[1] + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(csv.toString().getBytes(StandardCharsets.UTF_8));
    }

    private LocalDate[] range(LocalDate from, LocalDate to) {
        LocalDate today = LocalDate.now(clock.withZone(CAIRO));
        LocalDate end = to == null ? today : to;
        LocalDate start = from == null ? end.minusDays(29) : from;
        if (start.isAfter(end)) {
            throw ApiException.badRequest("BAD_RANGE", "The start date is after the end date.");
        }
        if (ChronoUnit.DAYS.between(start, end) >= MAX_DAYS) {
            throw ApiException.badRequest("BAD_RANGE", "Choose at most " + MAX_DAYS + " days.");
        }
        return new LocalDate[] {start, end};
    }

    private static String plain(BigDecimal value) {
        return value == null ? "" : value.toPlainString();
    }

    /**
     * One CSV line. Every value is quoted; a value that starts like a formula is prefixed with ' so a
     * spreadsheet shows it as text instead of running it.
     */
    static String row(String... values) {
        StringBuilder line = new StringBuilder();
        for (int i = 0; i < values.length; i++) {
            if (i > 0) line.append(',');
            String v = values[i] == null ? "" : values[i];
            if (!v.isEmpty() && "=+-@\t\r".indexOf(v.charAt(0)) >= 0) v = "'" + v;
            line.append('"').append(v.replace("\"", "\"\"")).append('"');
        }
        return line.append("\r\n").toString();
    }
}
