package store.lupinwear.security;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import store.lupinwear.shared.ApiException;

/**
 * Fixed-window limiter held in memory. It is per instance: with several Cloud Run instances the
 * effective limit is multiplied. The durable brute-force control is the account lockout in the database.
 */
@Component
public class RateLimiter {

    private final Cache<String, AtomicInteger> tenMinutes = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofMinutes(10))
            .maximumSize(200_000)
            .build();

    /** Allows {@code limit} calls per key in a 10 minute window, then answers 429. */
    public void check(String key, int limit) {
        int used = tenMinutes.get(key, k -> new AtomicInteger()).incrementAndGet();
        if (used > limit) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_REQUESTS",
                    "Too many attempts. Please wait a few minutes and try again.");
        }
    }

    public void reset() {
        tenMinutes.invalidateAll();
    }
}
