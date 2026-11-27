package store.lupinwear.notify;

import java.math.BigDecimal;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.util.HtmlUtils;
import store.lupinwear.mail.Mailer;
import store.lupinwear.order.OrderAdminService.StatusChanged;
import store.lupinwear.order.OrderService.OrderPlaced;

/**
 * Keeps the customer posted by email: a confirmation when they place an order, then a short note when
 * staff confirm it, ship it (with the courier, tracking number and tracking link), deliver it or cancel
 * it. Arabic first, then English. Only for customers with an email address (guests who checked out
 * with a phone number only get nothing). Runs after the change is saved, on its own thread, so a slow
 * or failing email never delays the order.
 */
@Component
public class CustomerOrderMail {

    private static final Logger log = LoggerFactory.getLogger(CustomerOrderMail.class);

    /** What the customer is told for each moment; null means no email for it. */
    enum Moment {
        PLACED("استلمنا طلبك", "We got your order",
                "شكرًا لطلبك! هنراجعه ونأكده معاك قريب.", "Thank you! We will review and confirm it with you soon."),
        CONFIRMED("طلبك اتأكد", "Your order is confirmed",
                "طلبك اتأكد وبنجهزه دلوقتي.", "Your order is confirmed and we are getting it ready."),
        SHIPPED("طلبك اتشحن", "Your order is on its way",
                "طلبك خرج للشحن وهيوصلك قريب.", "Your order has left us and is on its way to you."),
        DELIVERED("طلبك وصل", "Your order was delivered",
                "طلبك اتسلم. نتمنى القطع تعجبك!", "Your order was delivered. We hope you love it!"),
        CANCELLED("طلبك اتلغى", "Your order was cancelled",
                "طلبك اتلغى. لو عندك أي سؤال كلمنا.", "Your order was cancelled. Reach out if you have any questions.");

        final String titleAr;
        final String titleEn;
        final String bodyAr;
        final String bodyEn;

        Moment(String titleAr, String titleEn, String bodyAr, String bodyEn) {
            this.titleAr = titleAr;
            this.titleEn = titleEn;
            this.bodyAr = bodyAr;
            this.bodyEn = bodyEn;
        }

        static Moment of(String status) {
            return switch (status) {
                case "CONFIRMED" -> CONFIRMED;
                case "SHIPPED" -> SHIPPED;
                case "DELIVERED" -> DELIVERED;
                case "CANCELLED" -> CANCELLED;
                default -> null;
            };
        }
    }

    record Order(String reference, String email, String lang, String customerName, BigDecimal total,
            String carrier, String tracking, String trackingUrl) {
    }

    record Item(String nameAr, String nameEn, String size, int quantity) {
    }

    private final JdbcClient jdbc;
    private final Mailer mailer;
    private final String publicBaseUrl;

    public CustomerOrderMail(JdbcClient jdbc, Mailer mailer, @Value("${lupin.public-base-url}") String publicBaseUrl) {
        this.jdbc = jdbc;
        this.mailer = mailer;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onOrderPlaced(OrderPlaced event) {
        later(event.reference(), Moment.PLACED);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onStatusChanged(StatusChanged event) {
        Moment moment = Moment.of(event.status());
        if (moment != null) {
            later(event.reference(), moment);
        }
    }

    private void later(String reference, Moment moment) {
        Thread.ofVirtual().name("customer-mail-" + reference).start(() -> {
            try {
                Order order = load(reference);
                if (order == null || order.email() == null || order.email().isBlank()) {
                    return;
                }
                mailer.send(message(order, items(reference), moment));
            } catch (RuntimeException e) {
                log.error("Customer email for {} ({}) failed: {}", reference, moment, e.getMessage());
            }
        });
    }

    private Order load(String reference) {
        return jdbc.sql("""
                select o.reference, u.email, u.preferred_lang, o.customer_name, o.total,
                       (select s.carrier from shipments s where s.order_id = o.id order by s.id desc limit 1),
                       (select s.tracking_reference from shipments s where s.order_id = o.id order by s.id desc limit 1),
                       (select s.tracking_url from shipments s where s.order_id = o.id order by s.id desc limit 1)
                from orders o join users u on u.id = o.user_id
                where o.reference = :r and u.status = 'ACTIVE'
                """).param("r", reference)
                .query((rs, n) -> new Order(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getBigDecimal(5), rs.getString(6), rs.getString(7), rs.getString(8)))
                .optional().orElse(null);
    }

    private List<Item> items(String reference) {
        return jdbc.sql("""
                select coalesce(nullif(i.product_name_ar, ''), i.product_name), i.product_name, i.size_code, i.quantity
                from order_items i join orders o on o.id = i.order_id where o.reference = :r order by i.id
                """).param("r", reference)
                .query((rs, n) -> new Item(rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4))).list();
    }

    Mailer.Message message(Order o, List<Item> items, Moment m) {
        String link = publicBaseUrl + ("ar".equals(o.lang()) ? "/ar" : "") + "/orders/" + o.reference();
        boolean shipped = m == Moment.SHIPPED;
        String trackingUrl = o.trackingUrl() != null && o.trackingUrl().matches("https?://\\S+") ? o.trackingUrl() : null;

        StringBuilder text = new StringBuilder()
                .append(m.titleAr).append(" — ").append(o.reference()).append('\n').append(m.bodyAr).append('\n');
        if (shipped && o.carrier() != null) text.append("شركة الشحن: ").append(o.carrier()).append('\n');
        if (shipped && o.tracking() != null) text.append("رقم التتبع: ").append(o.tracking()).append('\n');
        text.append('\n').append(m.titleEn).append(" — ").append(o.reference()).append('\n').append(m.bodyEn).append('\n');
        if (shipped && o.carrier() != null) text.append("Courier: ").append(o.carrier()).append('\n');
        if (shipped && o.tracking() != null) text.append("Tracking number: ").append(o.tracking()).append('\n');
        text.append('\n');
        for (Item i : items) {
            text.append("• ").append(i.nameEn()).append(" · ").append(i.size()).append(" × ").append(i.quantity()).append('\n');
        }
        text.append("Total / الإجمالي: ").append(NewOrderNotifier.money(o.total())).append(" EGP\n\n");
        if (shipped && trackingUrl != null) text.append(trackingUrl).append('\n');
        text.append(link);

        StringBuilder rows = new StringBuilder();
        for (Item i : items) {
            rows.append("<tr><td style=\"padding:6px 0;border-bottom:1px solid #eee\">").append(esc(i.nameAr()))
                    .append("<br><span style=\"color:#6b675f;font-size:12px\" dir=\"ltr\">").append(esc(i.nameEn()))
                    .append(" · ").append(esc(i.size())).append("</span></td>")
                    .append("<td style=\"padding:6px 0;border-bottom:1px solid #eee;text-align:left\">× ")
                    .append(i.quantity()).append("</td></tr>");
        }
        StringBuilder shipping = new StringBuilder();
        if (shipped && (o.carrier() != null || o.tracking() != null)) {
            shipping.append("<p style=\"margin:12px 0 0\">");
            if (o.carrier() != null) shipping.append("شركة الشحن / Courier: <b>").append(esc(o.carrier())).append("</b><br>");
            if (o.tracking() != null) shipping.append("رقم التتبع / Tracking: <b dir=\"ltr\">").append(esc(o.tracking())).append("</b>");
            shipping.append("</p>");
        }
        if (shipped && trackingUrl != null) {
            shipping.append("<a href=\"").append(esc(trackingUrl)).append("\" style=\"display:inline-block;margin-top:12px;")
                    .append("border:1px solid #111;color:#111;text-decoration:none;padding:10px 16px;font-size:13px;font-weight:bold\">")
                    .append("تتبّع شحنتك · Track your parcel</a>");
        }
        String html = """
                <!doctype html><html dir="rtl"><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#111">
                <table role="presentation" width="100%%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
                <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e3ded3">
                <tr><td style="background:#0b0b0c;color:#f4f1ea;padding:16px 24px;font-size:13px;letter-spacing:4px">LUPIN.</td></tr>
                <tr><td style="padding:20px 24px;font-size:14px;line-height:1.7">
                <p style="margin:0;font-size:20px;font-weight:bold">%s</p>
                <p style="margin:4px 0 0">%s</p>
                <div dir="ltr" style="text-align:left;margin-top:12px;color:#6b675f">
                <p style="margin:0;font-weight:bold;color:#111">%s</p><p style="margin:2px 0 0">%s</p></div>
                <p style="margin:16px 0 8px;color:#6b675f">رقم الطلب / Order <b dir="ltr" style="color:#111">%s</b></p>
                %s
                <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-top:12px">%s</table>
                <p style="margin:12px 0 0;font-weight:bold">الإجمالي / Total: <span dir="ltr">%s EGP</span></p>
                <a href="%s" style="display:inline-block;margin-top:20px;background:#111;color:#fff;text-decoration:none;padding:12px 20px;font-size:13px;font-weight:bold">تابع طلبك · View your order</a>
                </td></tr></table></td></tr></table></body></html>""".formatted(
                esc(m.titleAr), esc(m.bodyAr), esc(m.titleEn), esc(m.bodyEn), esc(o.reference()), shipping, rows,
                NewOrderNotifier.money(o.total()), esc(link));
        String subject = m.titleAr + " · " + m.titleEn + " — " + o.reference();
        return new Mailer.Message(o.email(), subject, text.toString(), html);
    }

    private static String esc(String value) {
        return value == null ? "" : HtmlUtils.htmlEscape(value);
    }
}
