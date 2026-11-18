package store.lupinwear.notify;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class HttpTelegramGateway implements TelegramGateway {

    private static final Logger log = LoggerFactory.getLogger(HttpTelegramGateway.class);

    private final TelegramProperties props;
    private final RestClient http;
    private volatile String username;

    public HttpTelegramGateway(TelegramProperties props) {
        this.props = props;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(10));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    @Override
    public boolean configured() {
        return props.configured();
    }

    @Override
    public String botUsername() {
        if (username == null && configured()) {
            try {
                JsonNode me = http.get().uri(url("getMe")).retrieve().body(JsonNode.class);
                String name = me == null ? "" : me.path("result").path("username").asText("");
                username = name.isEmpty() ? null : name;
            } catch (RestClientException e) {
                log.warn("Telegram getMe failed: {}", safe(e));
            }
        }
        return username;
    }

    @Override
    public int sendMessage(long chatId, String html, String buttonText, String buttonUrl) {
        if (!configured()) {
            return 0;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("chat_id", chatId);
        body.put("text", html);
        body.put("parse_mode", "HTML");
        body.put("link_preview_options", Map.of("is_disabled", true));
        if (buttonUrl != null) {
            body.put("reply_markup", Map.of("inline_keyboard", List.of(List.of(Map.of("text", buttonText, "url", buttonUrl)))));
        }
        try {
            http.post().uri(url("sendMessage")).contentType(MediaType.APPLICATION_JSON).body(body).retrieve().toBodilessEntity();
            return 200;
        } catch (HttpClientErrorException e) {
            if (e.getStatusCode().value() != 403) {
                log.warn("Telegram sendMessage answered {}", e.getStatusCode().value());
            }
            return e.getStatusCode().value();
        } catch (RestClientException e) {
            log.warn("Telegram sendMessage failed: {}", safe(e));
            return 0;
        }
    }

    @Override
    public boolean setWebhook(String webhookUrl, String secret) {
        if (!configured()) {
            return false;
        }
        try {
            http.post().uri(url("setWebhook")).contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("url", webhookUrl, "secret_token", secret, "allowed_updates", List.of("message"),
                            "drop_pending_updates", true))
                    .retrieve().toBodilessEntity();
            return true;
        } catch (RestClientException e) {
            log.warn("Telegram setWebhook failed: {}", safe(e));
            return false;
        }
    }

    private String url(String method) {
        return props.apiBase() + "/bot" + props.botToken().trim() + "/" + method;
    }

    /** Exception messages can contain the request address, which contains the token. */
    private String safe(Exception e) {
        String message = String.valueOf(e.getMessage());
        return props.configured() ? message.replace(props.botToken().trim(), "***") : message;
    }
}
