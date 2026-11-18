package store.lupinwear.order;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.order.OrderService.OrderSummary;
import store.lupinwear.order.OrderService.OrderView;
import store.lupinwear.order.OrderService.PlaceOrderRequest;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.security.RateLimiter;
import store.lupinwear.shared.PageResponse;
import store.lupinwear.tracking.MetaConversions;

/** A customer's own orders. Every query is scoped to the signed-in user. */
@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {

    private final OrderService orders;
    private final RateLimiter rateLimiter;
    private final MetaConversions conversions;

    public OrderController(OrderService orders, RateLimiter rateLimiter, MetaConversions conversions) {
        this.orders = orders;
        this.rateLimiter = rateLimiter;
        this.conversions = conversions;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    OrderView place(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody PlaceOrderRequest body,
            HttpServletRequest request) {
        rateLimiter.check("order:" + user.id(), 20);
        OrderView order = orders.place(user.id(), body);
        // After the commit: tells Meta about the sale (a retry repeats the same event id, so Meta keeps one).
        conversions.purchaseLater(order.reference(), MetaConversions.Browser.from(request));
        return order;
    }

    @GetMapping
    PageResponse<OrderSummary> list(@AuthenticationPrincipal CurrentUser user,
            @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "10") int pageSize) {
        return orders.list(user.id(), page, pageSize);
    }

    @GetMapping("/{reference}")
    OrderView get(@AuthenticationPrincipal CurrentUser user, @PathVariable String reference) {
        return orders.get(user.id(), reference);
    }

    @PostMapping("/{reference}/cancel")
    OrderView cancel(@AuthenticationPrincipal CurrentUser user, @PathVariable String reference) {
        return orders.cancel(user.id(), reference);
    }

    @PostMapping("/{reference}/undo-cancel")
    OrderView undo(@AuthenticationPrincipal CurrentUser user, @PathVariable String reference) {
        return orders.undoCancel(user.id(), reference);
    }
}
