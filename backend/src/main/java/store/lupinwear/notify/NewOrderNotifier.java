package store.lupinwear.notify;

import java.math.BigDecimal;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.List;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.util.HtmlUtils;
import store.lupinwear.content.SiteSettings;
import store.lupinwear.mail.Mailer;
import store.lupinwear.order.OrderService.CustomerChangedOrder;
import store.lupinwear.order.OrderService.OrderPlaced;

/**
 * Tells the owner about each new order, by email and/or WhatsApp, to the addresses set in the
 * dashboard (Settings → New order alerts). Runs after the order is saved, on its own thread, so a
 * slow or failing message never delays or breaks checkout.
 */
@Component
public class NewOrderNotifier {

    private static final Logger log = LoggerFactory.getLogger(NewOrderNotifier.class);

    record Order(String reference, String customerName, String customerPhone, String governorate, String city,
            String address, BigDecimal total, String paymentMethod) {
    }

    record Item(String name, String colour, String size, int quantity) {
    }

    private final JdbcClient jdbc;
    private final SiteSettings settings;
    private final Mailer mailer;
    private final WhatsAppGateway whatsapp;
    private final String publicBaseUrl;

    public NewOrderNotifier(JdbcClient jdbc, SiteSettings settings, Mailer mailer, WhatsAppGateway whatsapp,
            @Value("${lupin.public-base-url}") String publicBaseUrl) {
        this.jdbc = jdbc;
        this.settings = settings;
        this.mailer = mailer;
        this.whatsapp = whatsapp;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderPlaced(OrderPlaced event) {
        Thread.ofVirtual().name("new-order-" + event.reference()).start(() -> {
            try {
                notifyOwner(event.reference());
            } catch (RuntimeException e) {
                log.error("New order alert for {} failed: {}", event.reference(), e.getMessage());
            }
        });
    }

    /** A customer cancelled (or took back a cancel) on their own: email only, WhatsApp is for new orders. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onCustomerChangedOrder(CustomerChangedOrder event) {
        Thread.ofVirtual().name("order-change-" + event.reference()).start(() -> {
            try {
                String email = settings.get("notifications").path("orderEmail").asText("").trim();
                if (email.isEmpty()) {
                    return;
                }
                Order order = load(event.reference());
                if (order != null) {
                    mailer.send(email(email, order, items(event.reference()),
                            event.cancelled() ? Kind.CANCELLED : Kind.RESTORED));
                }
            } catch (RuntimeException e) {
                log.error("Order change alert for {} failed: {}", event.reference(), e.getMessage());
            }
        });
    }

    enum Kind {
        NEW("طلب جديد", "#111"),
        CANCELLED("العميل لغى الطلب", "#9b1c1c"),
        RESTORED("العميل رجّع الطلب بعد ما لغاه", "#111");

        final String title;
        final String colour;

        Kind(String title, String colour) {
            this.title = title;
            this.colour = colour;
        }
    }

    void notifyOwner(String reference) {
        var config = settings.get("notifications");
        String email = config.path("orderEmail").asText("").trim();
        String phone = config.path("whatsappTo").asText("").trim();
        if (email.isEmpty() && (phone.isEmpty() || !whatsapp.configured())) {
            return;
        }
        Order order = load(reference);
        if (order == null) {
            return;
        }
        List<Item> items = items(reference);

        if (!email.isEmpty()) {
            mailer.send(email(email, order, items, Kind.NEW));
        }
        if (!phone.isEmpty() && whatsapp.configured()) {
            whatsapp.sendTemplate(international(phone), List.of(order.reference(), clean(order.customerName()),
                    money(order.total()), paymentLabel(order.paymentMethod())));
        }
    }

    private Order load(String reference) {
        Order order = jdbc.sql("""
                        select reference, customer_name, customer_phone, governorate_name_ar, city, address_line,
                               total, payment_method
                        from orders where reference = :r""")
                .param("r", reference)
                .query((rs, n) -> new Order(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6), rs.getBigDecimal(7), rs.getString(8)))
                .optional().orElse(null);
        return order;
    }

    private List<Item> items(String reference) {
        return jdbc.sql("""
                        select coalesce(nullif(i.product_name_ar, ''), i.product_name),
                               coalesce(nullif(i.color_name_ar, ''), i.color_name), i.size_code, i.quantity
                        from order_items i join orders o on o.id = i.order_id where o.reference = :r order by i.id""")
                .param("r", reference)
                .query((rs, n) -> new Item(rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4))).list();
    }

    Mailer.Message email(String to, Order o, List<Item> items, Kind kind) {
        String link = publicBaseUrl + "/admin/orders/" + o.reference();
        StringBuilder text = new StringBuilder()
                .append(kind.title).append(' ').append(o.reference()).append('\n')
                .append("العميل: ").append(o.customerName()).append(" — ").append(o.customerPhone()).append('\n')
                .append("العنوان: ").append(o.governorate()).append("، ").append(o.city()).append("، ").append(o.address()).append('\n')
                .append("الدفع: ").append(paymentLabel(o.paymentMethod())).append('\n')
                .append("الإجمالي: ").append(money(o.total())).append(" ج.م\n\n");
        StringBuilder rows = new StringBuilder();
        for (Item i : items) {
            text.append("• ").append(i.name()).append(" — ").append(i.colour()).append(" · ").append(i.size())
                    .append(" × ").append(i.quantity()).append('\n');
            rows.append("<tr><td style=\"padding:6px 0;border-bottom:1px solid #eee\">").append(esc(i.name()))
                    .append("<br><span style=\"color:#6b675f;font-size:12px\">").append(esc(i.colour())).append(" · ")
                    .append(esc(i.size())).append("</span></td><td style=\"padding:6px 0;border-bottom:1px solid #eee;text-align:left\">× ")
                    .append(i.quantity()).append("</td></tr>");
        }
        text.append('\n').append(link);
        String html = """
                <!doctype html><html dir="rtl"><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#111">
                <table role="presentation" width="100%%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
                <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e3ded3">
                <tr><td style="background:%s;color:#f4f1ea;padding:16px 24px;font-size:16px;font-weight:bold">%s %s</td></tr>
                <tr><td style="padding:20px 24px;font-size:14px;line-height:1.7">
                <p style="margin:0 0 4px;font-size:22px;font-weight:bold">%s ج.م</p>
                <p style="margin:0 0 16px;color:#6b675f">%s</p>
                <p style="margin:0"><b>%s</b> — <span dir="ltr">%s</span></p>
                <p style="margin:0 0 16px">%s، %s، %s</p>
                <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="font-size:14px">%s</table>
                <a href="%s" style="display:inline-block;margin-top:20px;background:#111;color:#fff;text-decoration:none;padding:12px 20px;font-size:13px;font-weight:bold">افتح الطلب في الداشبورد</a>
                </td></tr></table></td></tr></table></body></html>""".formatted(
                kind.colour, kind.title, esc(o.reference()), money(o.total()), esc(paymentLabel(o.paymentMethod())), esc(o.customerName()),
                esc(o.customerPhone()), esc(o.governorate()), esc(o.city()), esc(o.address()), rows, esc(link));
        return new Mailer.Message(to, kind.title + " " + o.reference() + " — " + money(o.total()) + " ج.م", text.toString(), html);
    }

    static String paymentLabel(String method) {
        return switch (method) {
            case "COD" -> "كاش عند الاستلام";
            case "INSTAPAY_MANUAL" -> "إنستاباي";
            case "VODAFONE_CASH_MANUAL" -> "محفظة إلكترونية";
            case "CARD" -> "كارت";
            case "WALLET" -> "محفظة (Paymob)";
            case "FAWRY" -> "فوري";
            default -> method;
        };
    }

    /** 01012345678 → 201012345678 (what WhatsApp expects). */
    static String international(String phone) {
        String digits = phone.replaceAll("\\D", "");
        return digits.startsWith("0") ? "2" + digits : digits;
    }

    /** 1060 → "1,060"; 2142.5 → "2,142.50". */
    static String money(BigDecimal amount) {
        boolean whole = amount.stripTrailingZeros().scale() <= 0;
        return new DecimalFormat(whole ? "#,##0" : "#,##0.00", DecimalFormatSymbols.getInstance(Locale.ROOT)).format(amount);
    }

    /** WhatsApp template values may not hold line breaks, tabs or long runs of spaces. */
    static String clean(String value) {
        String v = value == null ? "" : value.replaceAll("[\\r\\n\\t]+", " ").replaceAll(" {2,}", " ").trim();
        return v.length() > 60 ? v.substring(0, 60) : v;
    }

    private static String esc(String value) {
        return HtmlUtils.htmlEscape(value == null ? "" : value);
    }
}
