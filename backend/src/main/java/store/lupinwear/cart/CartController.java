package store.lupinwear.cart;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.cart.CartService.CartView;
import store.lupinwear.cart.CartService.GuestItem;
import store.lupinwear.catalog.application.CatalogQueryService;
import store.lupinwear.security.CurrentUser;

/** Signed-in customers only; the user comes from the access cookie, never from the request. */
@RestController
@RequestMapping("/api/v1/cart")
public class CartController {

    public record QuantityRequest(@NotNull @Min(1) @Max(CatalogQueryService.MAX_LINE_QUANTITY) Integer quantity) {
    }

    public record MergeItem(@NotNull Long variantId,
            @NotNull @Min(1) @Max(CatalogQueryService.MAX_LINE_QUANTITY) Integer quantity) {
    }

    public record MergeRequest(@NotNull @Size(max = CartService.MAX_LINES) List<@Valid @NotNull MergeItem> items) {
    }

    private final CartService cart;

    public CartController(CartService cart) {
        this.cart = cart;
    }

    @GetMapping
    CartView get(@AuthenticationPrincipal CurrentUser user) {
        return cart.view(user.id());
    }

    @PutMapping("/items/{variantId}")
    CartView set(@AuthenticationPrincipal CurrentUser user, @PathVariable long variantId,
            @Valid @RequestBody QuantityRequest body) {
        return cart.setQuantity(user.id(), variantId, body.quantity());
    }

    @DeleteMapping("/items/{variantId}")
    CartView remove(@AuthenticationPrincipal CurrentUser user, @PathVariable long variantId) {
        return cart.remove(user.id(), variantId);
    }

    @PostMapping("/merge")
    CartView merge(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody MergeRequest body) {
        return cart.merge(user.id(),
                body.items().stream().map(i -> new GuestItem(i.variantId(), i.quantity())).toList());
    }
}
