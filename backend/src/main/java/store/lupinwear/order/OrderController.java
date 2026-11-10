package store.lupinwear.order;

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

/** A customer's own orders. Every query is scoped to the signed-in user. */
@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {

    private final OrderService orders;
    private final RateLimiter rateLimiter;

    public OrderController(OrderService orders, RateLimiter rateLimiter) {
        this.orders = orders;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    OrderView place(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody PlaceOrderRequest body) {
        rateLimiter.check("order:" + user.id(), 20);
        return orders.place(user.id(), body);
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
