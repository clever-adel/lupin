package store.lupinwear.delivery;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Delivery options and what they cost in a governorate. An option with no governorate rows is offered
 * everywhere; otherwise only where it is listed, at the listed fee if one is set.
 */
@Service
@Transactional(readOnly = true)
public class DeliveryService {

    public record GovernorateView(int id, String code, String nameEn, String nameAr) {
    }

    public record OptionView(int id, String code, String type, String nameEn, String nameAr, String estimateEn,
            String estimateAr, String noteEn, String noteAr, BigDecimal fee) {
    }

    private static final String OPTIONS = """
            select o.id, o.code, o.type, o.name_en, o.name_ar, o.estimate_en, o.estimate_ar, o.note_en, o.note_ar,
                   coalesce(og.fee_override, o.fee) as fee
            from delivery_options o
            left join delivery_option_governorates og
                   on og.delivery_option_id = o.id and og.governorate_id = :g
            where o.active
              and exists (select 1 from governorates g where g.id = :g and g.active)
              and (og.governorate_id is not null
                   or not exists (select 1 from delivery_option_governorates x where x.delivery_option_id = o.id))
            """;

    private final JdbcClient jdbc;

    public DeliveryService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<GovernorateView> governorates() {
        return jdbc.sql("select id, code, name_en, name_ar from governorates where active order by id")
                .query((rs, n) -> new GovernorateView(rs.getInt(1), rs.getString(2), rs.getString(3), rs.getString(4)))
                .list();
    }

    public Optional<GovernorateView> governorate(int id) {
        return jdbc.sql("select id, code, name_en, name_ar from governorates where active and id = :id")
                .param("id", id)
                .query((rs, n) -> new GovernorateView(rs.getInt(1), rs.getString(2), rs.getString(3), rs.getString(4)))
                .optional();
    }

    public List<OptionView> options(int governorateId) {
        return jdbc.sql(OPTIONS + " order by o.sort_order, o.id").param("g", governorateId)
                .query(DeliveryService::map).list();
    }

    public Optional<OptionView> option(int governorateId, int optionId) {
        return jdbc.sql(OPTIONS + " and o.id = :o").param("g", governorateId).param("o", optionId)
                .query(DeliveryService::map).optional();
    }

    private static OptionView map(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        return new OptionView(rs.getInt("id"), rs.getString("code"), rs.getString("type"), rs.getString("name_en"),
                rs.getString("name_ar"), rs.getString("estimate_en"), rs.getString("estimate_ar"),
                rs.getString("note_en"), rs.getString("note_ar"), rs.getBigDecimal("fee"));
    }
}
