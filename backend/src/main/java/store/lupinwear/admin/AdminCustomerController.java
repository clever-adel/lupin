package store.lupinwear.admin;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.shared.PageResponse;

/**
 * Everyone who has an account on the store and is not staff. Read only. Staff already see each
 * customer's name, phone and address on their orders, so admins may see this list too.
 */
@RestController
@RequestMapping("/api/v1/admin/customers")
@PreAuthorize("hasAnyRole('ADMIN','OWNER')")
@Transactional(readOnly = true)
public class AdminCustomerController {

    /** An order counts as money in once it is paid or on its way; pending, cancelled and refunded do not. */
    static final String COUNTED = "('PAID','CONFIRMED','PROCESSING','SHIPPED','DELIVERED')";

    public record CustomerRow(UUID id, String fullName, String email, String phone, String signUp, String status,
            Instant joinedAt, Instant lastLoginAt, int orders, BigDecimal spent, Instant lastOrderAt,
            String governorate, boolean marketingOptIn) {
    }

    public record Summary(long customers, long newThisWeek, long withOrders, long marketingOptIn) {
    }

    private static final String CUSTOMERS = """
            from users u
            left join customer_profiles cp on cp.user_id = u.id
            left join lateral (
                select count(*) as n,
                       coalesce(sum(o.total) filter (where o.status in %s), 0) as spent,
                       max(o.placed_at) as last_at
                from orders o where o.user_id = u.id) agg on true
            left join lateral (
                select o.customer_phone, o.governorate_name
                from orders o where o.user_id = u.id order by o.placed_at desc limit 1) lo on true
            where u.deleted_at is null
              and not exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                              where ur.user_id = u.id and r.code in ('ADMIN', 'OWNER'))
            """.formatted(COUNTED);

    private static final Map<String, String> SORTS = Map.of(
            "newest", "u.created_at desc",
            "spent", "agg.spent desc, agg.n desc, u.created_at desc",
            "orders", "agg.n desc, agg.spent desc, u.created_at desc",
            "active", "u.last_login_at desc nulls last, u.created_at desc");

    private final JdbcClient jdbc;

    public AdminCustomerController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public PageResponse<CustomerRow> list(@RequestParam(required = false) String q,
            @RequestParam(defaultValue = "newest") String sort, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int pageSize) {
        int size = Math.max(1, Math.min(pageSize, 100));
        int index = Math.max(0, page);
        StringBuilder where = new StringBuilder();
        Map<String, Object> params = new HashMap<>();
        String query = q == null ? "" : q.trim();
        if (!query.isEmpty()) {
            query = query.substring(0, Math.min(query.length(), 80));
            where.append(" and (u.full_name ilike :q escape '\\' or u.email ilike :q escape '\\'"
                    + " or u.phone like :q escape '\\' or lo.customer_phone like :q escape '\\')");
            params.put("q", "%" + like(query) + "%");
        }
        long total = jdbc.sql("select count(*) " + CUSTOMERS + where).params(params).query(Long.class).single();
        params.put("limit", size);
        params.put("offset", (long) index * size);
        String order = SORTS.getOrDefault(sort, SORTS.get("newest"));
        List<CustomerRow> rows = jdbc.sql("""
                select u.id, u.full_name, u.email, coalesce(u.phone, lo.customer_phone) as phone,
                       exists (select 1 from oauth_identities oi where oi.user_id = u.id and oi.provider = 'GOOGLE')
                           as google,
                       u.status, u.created_at, u.last_login_at, agg.n, agg.spent, agg.last_at, lo.governorate_name,
                       coalesce(cp.marketing_opt_in, false) as opt_in
                """ + CUSTOMERS + where + " order by " + order + ", u.id limit :limit offset :offset")
                .params(params)
                .query((rs, n) -> new CustomerRow(rs.getObject("id", UUID.class), rs.getString("full_name"),
                        rs.getString("email"), rs.getString("phone"), rs.getBoolean("google") ? "GOOGLE" : "EMAIL",
                        rs.getString("status"), instant(rs.getObject("created_at", OffsetDateTime.class)),
                        instant(rs.getObject("last_login_at", OffsetDateTime.class)), rs.getInt("n"),
                        rs.getBigDecimal("spent"), instant(rs.getObject("last_at", OffsetDateTime.class)),
                        rs.getString("governorate_name"), rs.getBoolean("opt_in")))
                .list();
        return PageResponse.of(rows, index, size, total);
    }

    @GetMapping("/summary")
    public Summary summary() {
        return jdbc.sql("""
                select count(*),
                       count(*) filter (where u.created_at > now() - interval '7 days'),
                       count(*) filter (where agg.n > 0),
                       count(*) filter (where coalesce(cp.marketing_opt_in, false))
                """ + CUSTOMERS)
                .query((rs, n) -> new Summary(rs.getLong(1), rs.getLong(2), rs.getLong(3), rs.getLong(4)))
                .single();
    }

    private static String like(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private static Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }
}
