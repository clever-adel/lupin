package store.lupinwear.tracking;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class HttpMetaGateway implements MetaGateway {

    private static final Logger log = LoggerFactory.getLogger(HttpMetaGateway.class);

    private final MetaProperties props;
    private final RestClient http;

    public HttpMetaGateway(MetaProperties props) {
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
    public boolean send(String pixelId, Map<String, Object> payload) {
        if (!configured() || pixelId == null || !pixelId.matches("\\d{10,20}")) {
            return false;
        }
        // The token goes in the body, never the address, so it cannot end up in an access log.
        Map<String, Object> body = new LinkedHashMap<>(payload);
        body.put("access_token", props.capiToken().trim());
        if (props.testEventCode() != null && !props.testEventCode().isBlank()) {
            body.put("test_event_code", props.testEventCode().trim());
        }
        try {
            http.post().uri(props.graphBase() + "/" + pixelId + "/events").contentType(MediaType.APPLICATION_JSON)
                    .body(body).retrieve().toBodilessEntity();
            return true;
        } catch (HttpStatusCodeException e) {
            log.warn("Meta Conversions API answered {}: {}", e.getStatusCode().value(),
                    e.getResponseBodyAsString().replace(props.capiToken().trim(), "***"));
            return false;
        } catch (RestClientException e) {
            log.warn("Meta Conversions API failed: {}", e.getClass().getSimpleName());
            return false;
        }
    }
}
