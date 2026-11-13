package store.lupinwear.shipping;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.order.OrderAdminService.AdminOrderView;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.security.RateLimiter;
import store.lupinwear.shipping.ShippingService.BostaInfo;
import store.lupinwear.shipping.ShippingService.SendRequest;

@RestController
public class ShippingController {

    public record SendBody(@NotBlank @Size(max = 64) String districtId, @Size(max = 200) String notes) {
    }

    private final ShippingService shipping;
    private final RateLimiter rateLimiter;

    public ShippingController(ShippingService shipping, RateLimiter rateLimiter) {
        this.shipping = shipping;
        this.rateLimiter = rateLimiter;
    }

    // ── staff ──

    @GetMapping("/api/v1/admin/orders/{reference}/bosta")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER')")
    BostaInfo info(@PathVariable String reference) {
        return shipping.info(reference);
    }

    @PostMapping("/api/v1/admin/orders/{reference}/bosta")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER')")
    AdminOrderView send(@AuthenticationPrincipal CurrentUser user, @PathVariable String reference,
            @Valid @RequestBody SendBody body) {
        rateLimiter.check("bosta:" + user.id(), 30);
        return shipping.send(user.id(), reference, new SendRequest(body.districtId(), body.notes()));
    }

    // ── Bosta → us. No session and no CSRF token: the secret header we gave Bosta is the authentication. ──

    @PostMapping("/api/v1/shipping/webhooks/bosta")
    ResponseEntity<Void> webhook(HttpServletRequest request, @RequestBody JsonNode body) {
        if (!shipping.authentic(request.getHeader(shipping.webhookHeader()))) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        shipping.handleWebhook(body);
        return ResponseEntity.ok().build();
    }
}
