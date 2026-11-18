package store.lupinwear.payment;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
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
import org.springframework.web.multipart.MultipartFile;
import store.lupinwear.order.OrderService;
import store.lupinwear.order.OrderService.OrderView;
import store.lupinwear.payment.PaymentService.PayRedirect;
import store.lupinwear.payment.PaymentService.Receipt;
import store.lupinwear.payment.PaymentService.TransferView;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.security.RateLimiter;
import store.lupinwear.shared.ApiException;

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

    @PostMapping(path = "/api/v1/orders/{reference}/payment/transfer", consumes = MediaType.APPLICATION_JSON_VALUE)
    OrderView transfer(@AuthenticationPrincipal CurrentUser user, @PathVariable String reference,
            @Valid @RequestBody TransferRequest body) {
        rateLimiter.check("pay:" + user.id(), 20);
        payments.submitTransfer(user.id(), reference, body.reference(), null);
        return orders.get(user.id(), reference);
    }

    /** The same, as a form: the reference number and/or a screenshot of the transfer (at least one). */
    @PostMapping(path = "/api/v1/orders/{reference}/payment/transfer", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    OrderView transferWithReceipt(@AuthenticationPrincipal CurrentUser user, @PathVariable String reference,
            @RequestParam(name = "reference", required = false) String transferReference,
            @RequestParam(name = "receipt", required = false) MultipartFile receipt) throws IOException {
        rateLimiter.check("pay:" + user.id(), 20);
        String ref = transferReference == null ? "" : transferReference.trim();
        if (!ref.isEmpty() && !ref.matches("^[A-Za-z0-9 ._/-]{4,100}$")) {
            throw ApiException.badRequest("VALIDATION_FAILED", "Use the reference number shown in your banking app");
        }
        Receipt image = null;
        if (receipt != null && !receipt.isEmpty()) {
            if (receipt.getSize() > PaymentService.RECEIPT_MAX_BYTES) {
                throw ApiException.badRequest("RECEIPT_TOO_LARGE", "The screenshot must be smaller than 5 MB.");
            }
            byte[] bytes = receipt.getBytes();
            String type = PaymentService.imageType(bytes);
            if (type == null) {
                throw ApiException.badRequest("RECEIPT_NOT_IMAGE", "Send the screenshot as a JPG, PNG or WebP image.");
            }
            image = new Receipt(type, bytes);
        }
        payments.submitTransfer(user.id(), reference, ref, image);
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

    /** The customer's screenshot. Private: never cached by the browser or a proxy, never sniffed as HTML. */
    @GetMapping("/api/v1/admin/payments/{id}/receipt")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER')")
    ResponseEntity<byte[]> receipt(@PathVariable UUID id) {
        Receipt receipt = payments.receipt(id).orElseThrow(() -> ApiException.notFound("Receipt"));
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(receipt.contentType()))
                .cacheControl(CacheControl.noStore().cachePrivate())
                .header("X-Content-Type-Options", "nosniff")
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"transfer-" + id + "\"")
                .body(receipt.bytes());
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
