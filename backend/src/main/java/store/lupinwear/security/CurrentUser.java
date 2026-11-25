package store.lupinwear.security;

import java.util.Set;
import java.util.UUID;

/**
 * The authenticated principal. Built from the access token only; no database hit per request.
 * {@code family} is the sign-in (refresh family) the token belongs to; null in tokens from before it existed.
 */
public record CurrentUser(UUID id, Set<String> roles, UUID family) {

    public boolean isStaff() {
        return roles.contains("ADMIN") || roles.contains("OWNER");
    }
}
