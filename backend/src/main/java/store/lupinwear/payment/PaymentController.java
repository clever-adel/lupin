package store.lupinwear.payment;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.order.OrderService;
import store.lupinwear.order.OrderService.OrderView;
import store.lupinwear.payment.PaymentService.PayRedirect;
import store.lupinwear.payment.PaymentService.TransferView;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.security.RateLimiter;

@RestController
public class PaymentController {

    public record TransferRequest(
            @NotBlank @Size(min = 4, max = 100) @Pattern(regexp = "^[A-Za-z0-9 ._/-]+$",
                    message = "Use the reference number shown in your banking app") String reference) {
    }

    public record DecisionRequest(@Size(max = 300) String note) {
    }

    private final PaymentService payments;
    private final OrderService orders;
    private final RateLimiter rateLimiter;

    public PaymentController(PaymentService payments, OrderService orders, RateLimiter rateLimiter) {
        this.payments = payments;
        this.orders = orders;
        this.rateLimiter = rateLimiter;
    }

    // ── customer ──

    @PostMapping("/api/v1/orders/{reference}/payment/paymob")
    PayRedirect payOnline(@AuthenticationPrincipal CurrentUser user, @PathVariable String reference) {
        rateLimiter.check("pay:" + user.id(), 20);
        return payments.startPaymob(user.id(), reference);
    }

    @PostMapping("/api/v1/orders/{reference}/payment/transfer")
    OrderView transfer(@AuthenticationPrincipal CurrentUser user, @PathVariable String reference,
            @Valid @RequestBody TransferRequest body) {
        rateLimiter.check("pay:" + user.id(), 20);
        payments.submitTransfer(user.id(), reference, body.reference());
        return orders.get(user.id(), reference);
    }

    // ── Paymob → us. No session and no CSRF token: the HMAC signature is the authentication. ──

    @PostMapping("/api/v1/payments/webhooks/paymob")
    ResponseEntity<Void> paymobWebhook(@RequestParam(required = false) String hmac, @RequestBody JsonNode body) {
        return payments.handlePaymobWebhook(body, hmac) ? ResponseEntity.ok().build()
                : ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }

    // ── staff ──

    @GetMapping("/api/v1/admin/payments/transfers")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER')")
    List<TransferView> transfers() {
        return payments.transfersToVerify();
    }

    @PostMapping("/api/v1/admin/payments/{id}/confirm")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void confirm(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id,
            @Valid @RequestBody DecisionRequest body) {
        payments.decideTransfer(user.id(), id, true, body.note());
    }

    @PostMapping("/api/v1/admin/payments/{id}/reject")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void reject(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id,
            @Valid @RequestBody DecisionRequest body) {
        payments.decideTransfer(user.id(), id, false, body.note());
    }
}
