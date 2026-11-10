package store.lupinwear.security;

import java.util.Set;
import java.util.UUID;

/** The authenticated principal. Built from the access token only; no database hit per request. */
public record CurrentUser(UUID id, Set<String> roles) {

    public boolean isStaff() {
        return roles.contains("ADMIN") || roles.contains("OWNER");
    }
}
