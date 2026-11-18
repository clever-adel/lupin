package store.lupinwear.notify;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.security.RateLimiter;

/** Staff turn new-order push notifications on or off for the browser they are using. */
@RestController
@RequestMapping("/api/v1/admin/push")
@PreAuthorize("hasAnyRole('ADMIN','OWNER')")
public class PushController {

    public record Keys(@NotBlank @Size(max = 200) String p256dh, @NotBlank @Size(max = 100) String auth) {
    }

    public record SubscribeRequest(@NotBlank @Size(max = 1000) String endpoint, @NotNull @Valid Keys keys) {
    }

    public record EndpointRequest(@NotBlank @Size(max = 1000) String endpoint) {
    }

    private final StaffPush push;
    private final RateLimiter rateLimiter;

    public PushController(StaffPush push, RateLimiter rateLimiter) {
        this.push = push;
        this.rateLimiter = rateLimiter;
    }

    @GetMapping("/key")
    Map<String, String> key() {
        return Map.of("publicKey", push.publicKey());
    }

    @PostMapping("/subscriptions")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void subscribe(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody SubscribeRequest body,
            @RequestHeader(value = HttpHeaders.USER_AGENT, required = false) String userAgent) {
        rateLimiter.check("push:" + user.id(), 30);
        push.subscribe(user.id(), new StaffPush.Subscription(body.endpoint(), body.keys().p256dh(),
                body.keys().auth()), userAgent);
    }

    @PostMapping("/subscriptions/remove")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void unsubscribe(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody EndpointRequest body) {
        push.unsubscribe(user.id(), body.endpoint());
    }

    @PostMapping("/subscriptions/status")
    Map<String, Boolean> status(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody EndpointRequest body) {
        return Map.of("subscribed", push.subscribed(user.id(), body.endpoint()));
    }

    /** A test message to this staff member's own browsers. */
    @PostMapping("/test")
    Map<String, Integer> test(@AuthenticationPrincipal CurrentUser user) {
        rateLimiter.check("push-test:" + user.id(), 10);
        return Map.of("delivered", push.sendTo(user.id(), "LUPIN — تجربة الإشعارات",
                "الإشعارات شغالة. هيوصلك إشعار زي ده مع كل طلب جديد.", "/admin", "lupin-test"));
    }
}
