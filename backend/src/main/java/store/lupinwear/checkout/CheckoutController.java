package store.lupinwear.checkout;

import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.checkout.PricingService.QuoteRequest;
import store.lupinwear.checkout.PricingService.QuoteView;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.security.RateLimiter;

@RestController
@RequestMapping("/api/v1/checkout")
public class CheckoutController {

    private final PricingService pricing;
    private final RateLimiter rateLimiter;

    public CheckoutController(PricingService pricing, RateLimiter rateLimiter) {
        this.pricing = pricing;
        this.rateLimiter = rateLimiter;
    }

    /** Prices the signed-in customer's bag. Changes nothing; limited so promo codes cannot be guessed in bulk. */
    @PostMapping("/quote")
    QuoteView quote(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody QuoteRequest body) {
        if (body.promoCode() != null && !body.promoCode().isBlank()) {
            rateLimiter.check("promo:" + user.id(), 30);
        }
        return pricing.quote(user.id(), body).view();
    }
}
