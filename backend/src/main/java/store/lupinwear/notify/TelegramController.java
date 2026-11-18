package store.lupinwear.notify;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.security.RateLimiter;

@RestController
public class TelegramController {

    private final StaffTelegram telegram;
    private final RateLimiter rateLimiter;

    public TelegramController(StaffTelegram telegram, RateLimiter rateLimiter) {
        this.telegram = telegram;
        this.rateLimiter = rateLimiter;
    }

    // ── staff: link this person's Telegram ──

    @GetMapping("/api/v1/admin/telegram")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER')")
    StaffTelegram.Status status(@AuthenticationPrincipal CurrentUser user) {
        return telegram.status(user.id());
    }

    @PostMapping("/api/v1/admin/telegram/link")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER')")
    Map<String, String> link(@AuthenticationPrincipal CurrentUser user) {
        rateLimiter.check("telegram-link:" + user.id(), 20);
        return Map.of("url", telegram.linkUrl(user.id()));
    }

    @PostMapping("/api/v1/admin/telegram/unlink")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void unlink(@AuthenticationPrincipal CurrentUser user) {
        telegram.unlink(user.id());
    }

    @PostMapping("/api/v1/admin/telegram/test")
    @PreAuthorize("hasAnyRole('ADMIN','OWNER')")
    Map<String, Integer> test(@AuthenticationPrincipal CurrentUser user) {
        rateLimiter.check("telegram-test:" + user.id(), 10);
        return Map.of("sent", telegram.sendTo(user.id(),
                "🔔 <b>تجربة تنبيهات LUPIN</b>\nكده هيوصلك كل طلب جديد هنا.", "افتح الداشبورد", "/admin"));
    }

    // ── Telegram → us. No session and no CSRF token: the secret header is the authentication. ──

    @PostMapping(StaffTelegram.WEBHOOK_PATH)
    ResponseEntity<Void> webhook(@RequestHeader(value = "X-Telegram-Bot-Api-Secret-Token", required = false) String secret,
            @RequestBody JsonNode update) {
        if (!telegram.secretMatches(secret)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        rateLimiter.check("telegram-webhook", 600);
        telegram.handle(update);
        return ResponseEntity.ok().build();
    }
}
