package store.lupinwear.notify;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.time.Clock;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import store.lupinwear.shared.ApiException;

/**
 * Push notifications to the phones and computers where an owner or admin turned "new order alerts"
 * on. Only the big browser push services are accepted as addresses, so a subscription can never make
 * this server call anywhere else.
 */
@Service
public class StaffPush {

    private static final Logger log = LoggerFactory.getLogger(StaffPush.class);
    private static final List<String> PUSH_HOSTS = List.of(".googleapis.com", ".push.services.mozilla.com",
            ".push.apple.com", ".notify.windows.com");
    private static final int MAX_PER_USER = 10;

    public record Subscription(String endpoint, String p256dh, String auth) {
    }

    private record Keys(ECPrivateKey privateKey, byte[] publicRaw) {
    }

    private final JdbcClient jdbc;
    private final PushGateway gateway;
    private final ObjectMapper json;
    private final Clock clock;
    private final String subject;
    private volatile Keys keys;

    public StaffPush(JdbcClient jdbc, PushGateway gateway, ObjectMapper json, Clock clock,
            @Value("${lupin.public-base-url}") String publicBaseUrl) {
        this.jdbc = jdbc;
        this.gateway = gateway;
        this.json = json;
        this.clock = clock;
        this.subject = publicBaseUrl.startsWith("https://") ? publicBaseUrl.replaceAll("/+$", "")
                : "mailto:no-reply@lupinwear.store";
    }

    /** What the browser needs to subscribe (the VAPID public key, base64url). */
    public String publicKey() {
        return WebPush.b64(keys().publicRaw());
    }

    public void subscribe(UUID user, Subscription s, String device) {
        if (!allowed(s.endpoint())) {
            throw ApiException.badRequest("PUSH_ENDPOINT_REFUSED", "This browser's push service is not supported.");
        }
        try {
            byte[] p256dh = WebPush.unb64(s.p256dh());
            byte[] auth = WebPush.unb64(s.auth());
            WebPush.publicKey(p256dh, ((ECPublicKey) WebPush.newKeyPair().getPublic()).getParams());
            if (auth.length != 16) {
                throw new GeneralSecurityException("auth secret is not 16 bytes");
            }
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw ApiException.badRequest("PUSH_KEYS_INVALID", "The browser sent keys that cannot be used.");
        }
        jdbc.sql("""
                insert into push_subscriptions (user_id, endpoint, p256dh, auth, device)
                values (:u, :e, :k, :a, :d)
                on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
                    auth = excluded.auth, device = excluded.device
                """).param("u", user).param("e", s.endpoint()).param("k", s.p256dh()).param("a", s.auth())
                .param("d", device == null ? null : device.substring(0, Math.min(200, device.length()))).update();
        // Old browsers of the same person drop off rather than pile up.
        jdbc.sql("""
                delete from push_subscriptions where user_id = :u and id not in (
                    select id from push_subscriptions where user_id = :u order by created_at desc limit :n)
                """).param("u", user).param("n", MAX_PER_USER).update();
    }

    public void unsubscribe(UUID user, String endpoint) {
        jdbc.sql("delete from push_subscriptions where user_id = :u and endpoint = :e")
                .param("u", user).param("e", endpoint).update();
    }

    public boolean subscribed(UUID user, String endpoint) {
        return jdbc.sql("select count(*) from push_subscriptions where user_id = :u and endpoint = :e")
                .param("u", user).param("e", endpoint).query(Long.class).single() > 0;
    }

    /** To every active owner and admin browser. Returns how many were delivered. Never throws. */
    public int send(String title, String body, String url, String tag) {
        return sendTo(null, title, body, url, tag);
    }

    /** As {@link #send}, limited to one staff member's browsers when {@code onlyUser} is set (a test). */
    public int sendTo(UUID onlyUser, String title, String body, String url, String tag) {
        List<Map<String, String>> targets = jdbc.sql("""
                select s.id::text as id, s.endpoint, s.p256dh, s.auth from push_subscriptions s
                join users u on u.id = s.user_id
                where u.status = 'ACTIVE' and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                    where ur.user_id = u.id and r.code in ('OWNER', 'ADMIN'))
                  and (cast(:only as uuid) is null or u.id = :only)
                """).param("only", onlyUser).query((rs, n) -> Map.of("id", rs.getString(1), "endpoint", rs.getString(2),
                        "p256dh", rs.getString(3), "auth", rs.getString(4))).list();
        if (targets.isEmpty()) {
            return 0;
        }
        byte[] payload;
        try {
            Map<String, String> message = new LinkedHashMap<>();
            message.put("title", title);
            message.put("body", body);
            message.put("url", url);
            message.put("tag", tag);
            payload = json.writeValueAsBytes(message);
        } catch (Exception e) {
            payload = title.getBytes(StandardCharsets.UTF_8);
        }
        Keys k = keys();
        int delivered = 0;
        for (Map<String, String> t : targets) {
            String endpoint = t.get("endpoint");
            if (!allowed(endpoint)) {
                continue;
            }
            try {
                byte[] encrypted = WebPush.encrypt(payload, WebPush.unb64(t.get("p256dh")), WebPush.unb64(t.get("auth")));
                String authorization = WebPush.vapidHeader(endpoint, k.privateKey(), k.publicRaw(), subject,
                        clock.instant());
                int status = gateway.deliver(endpoint, authorization, encrypted);
                UUID id = UUID.fromString(t.get("id"));
                if (status == 404 || status == 410) {
                    // The browser unsubscribed or the app was removed: forget it.
                    jdbc.sql("delete from push_subscriptions where id = :id").param("id", id).update();
                } else if (status >= 200 && status < 300) {
                    delivered++;
                    jdbc.sql("update push_subscriptions set last_success_at = now() where id = :id")
                            .param("id", id).update();
                }
            } catch (GeneralSecurityException | IllegalArgumentException e) {
                log.warn("Could not prepare a push message: {}", e.getMessage());
            }
        }
        return delivered;
    }

    static boolean allowed(String endpoint) {
        try {
            URI uri = URI.create(endpoint);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
            return "https".equals(uri.getScheme()) && endpoint.length() <= 1000 && uri.getUserInfo() == null
                    && (uri.getPort() == -1 || uri.getPort() == 443)
                    && PUSH_HOSTS.stream().anyMatch(host::endsWith);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    /** Loaded once; made and saved on first use. Two servers racing both end up with the saved pair. */
    private Keys keys() {
        Keys k = keys;
        if (k != null) {
            return k;
        }
        synchronized (this) {
            if (keys == null) {
                KeyPair fresh = WebPush.newKeyPair();
                jdbc.sql("""
                        insert into web_push_keys (id, public_key, private_key) values (1, :pub, :priv)
                        on conflict (id) do nothing""")
                        .param("pub", WebPush.b64(WebPush.raw((ECPublicKey) fresh.getPublic())))
                        .param("priv", Base64.getEncoder().encodeToString(fresh.getPrivate().getEncoded())).update();
                Map<String, String> row = jdbc.sql("select public_key, private_key from web_push_keys where id = 1")
                        .query((rs, n) -> Map.of("pub", rs.getString(1), "priv", rs.getString(2))).single();
                try {
                    keys = new Keys(WebPush.privateKey(Base64.getDecoder().decode(row.get("priv"))),
                            WebPush.unb64(row.get("pub")));
                } catch (GeneralSecurityException e) {
                    throw new IllegalStateException("Stored push keys are unreadable", e);
                }
            }
            return keys;
        }
    }
}
