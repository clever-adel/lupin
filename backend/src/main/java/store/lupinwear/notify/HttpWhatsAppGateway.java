package store.lupinwear.notify;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * POST graph.facebook.com/{version}/{phone-number-id}/messages with a template message, from Meta's
 * WhatsApp Cloud API reference ("Send message templates"). Not yet run against a real Meta account.
 */
@Component
public class HttpWhatsAppGateway implements WhatsAppGateway {

    private static final Logger log = LoggerFactory.getLogger(HttpWhatsAppGateway.class);

    private final WhatsAppProperties props;
    private final RestClient http;

    public HttpWhatsAppGateway(WhatsAppProperties props) {
        this.props = props;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(15));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    @Override
    public boolean configured() {
        return props.configured();
    }

    @Override
    public void sendTemplate(String to, List<String> bodyValues) {
        if (!props.configured()) {
            return;
        }
        var parameters = bodyValues.stream().map(v -> Map.of("type", "text", "text", v)).toList();
        var body = Map.of(
                "messaging_product", "whatsapp",
                "to", to,
                "type", "template",
                "template", Map.of(
                        "name", props.template(),
                        "language", Map.of("code", props.templateLang()),
                        "components", List.of(Map.of("type", "body", "parameters", parameters))));
        try {
            http.post().uri("https://graph.facebook.com/{v}/{id}/messages", props.apiVersion(), props.phoneNumberId())
                    .header("Authorization", "Bearer " + props.token())
                    .contentType(MediaType.APPLICATION_JSON).body(body).retrieve().toBodilessEntity();
        } catch (RestClientException e) {
            log.error("WhatsApp message could not be sent: {}", e.getMessage());
        }
    }
}
