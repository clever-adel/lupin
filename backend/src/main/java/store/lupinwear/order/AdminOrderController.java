package store.lupinwear.order;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.order.OrderAdminService.AdminOrderView;
import store.lupinwear.order.OrderAdminService.OrderRow;
import store.lupinwear.order.OrderAdminService.StatusChange;
import store.lupinwear.order.OrderAdminService.Summary;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.shared.PageResponse;

/** Staff only. Guarded twice: the /api/v1/admin/** URL rule and the class-level role check. */
@RestController
@RequestMapping("/api/v1/admin")
@PreAuthorize("hasAnyRole('ADMIN','OWNER')")
public class AdminOrderController {

    public record StatusRequest(
            @NotNull @Pattern(regexp = "CONFIRMED|PROCESSING|SHIPPED|DELIVERED|CANCELLED") String status,
            @Size(max = 300) String note,
            @Size(max = 60) String carrier,
            @Size(max = 100) String trackingReference) {
    }

    private final OrderAdminService orders;

    public AdminOrderController(OrderAdminService orders) {
        this.orders = orders;
    }

    @GetMapping("/summary")
    Summary summary() {
        return orders.summary();
    }

    @GetMapping("/orders")
    PageResponse<OrderRow> list(@RequestParam(required = false) String status,
            @RequestParam(required = false) String q, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int pageSize) {
        String query = q == null ? null : q.substring(0, Math.min(q.length(), 80));
        return orders.list(status, query, page, pageSize);
    }

    @GetMapping("/orders/{reference}")
    AdminOrderView get(@PathVariable String reference) {
        return orders.get(reference);
    }

    public record RefundRequest(@Size(max = 300) String note) {
    }

    /** Giving money back is the owner's call (permission payments:refund). */
    @PostMapping("/orders/{reference}/refunded")
    @PreAuthorize("hasRole('OWNER')")
    AdminOrderView refunded(@AuthenticationPrincipal CurrentUser user, @PathVariable String reference,
            @Valid @RequestBody RefundRequest body) {
        return orders.markRefunded(user.id(), reference, body.note());
    }

    @PostMapping("/orders/{reference}/status")
    AdminOrderView changeStatus(@AuthenticationPrincipal CurrentUser user, @PathVariable String reference,
            @Valid @RequestBody StatusRequest body) {
        return orders.changeStatus(user.id(),
                reference, new StatusChange(body.status(), body.note(), body.carrier(), body.trackingReference()));
    }
}
