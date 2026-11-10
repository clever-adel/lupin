package store.lupinwear.payment;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import store.lupinwear.shared.ApiException;

/**
 * Paymob "Create Intention" (server to server, secret key in the Authorization header).
 * Written from Paymob's public documentation; NOT yet exercised against a real merchant account
 * (IMPLEMENTATION_STATUS.md). The request shape must be confirmed in Paymob test mode before launch.
 */
@Component
public class HttpPaymobGateway implements PaymobGateway {

    private static final Logger log = LoggerFactory.getLogger(HttpPaymobGateway.class);

    private final PaymobProperties props;
    private final RestClient http;

    public HttpPaymobGateway(PaymobProperties props) {
        this.props = props;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(15));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    @Override
    public Intention createIntention(IntentionRequest r) {
        if (!props.configured()) {
            throw unavailable();
        }
        Map<String, Object> billing = new LinkedHashMap<>();
        billing.put("first_name", r.firstName());
        billing.put("last_name", r.lastName());
        billing.put("phone_number", r.phone());
        if (r.email() != null) {
            billing.put("email", r.email());
        }
        billing.put("country", "EG");
        billing.put("city", r.city());
        billing.put("street", r.street());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("amount", r.amountCents());
        body.put("currency", "EGP");
        body.put("payment_methods", List.of(r.integrationId()));
        // One line for the whole order: Paymob requires the items to add up to the amount exactly.
        body.put("items", List.of(Map.of("name", r.itemName(), "amount", r.amountCents(), "quantity", 1)));
        body.put("billing_data", billing);
        body.put("special_reference", r.specialReference());
        body.put("notification_url", r.notificationUrl());
        body.put("redirection_url", r.redirectionUrl());
        body.put("expiration", r.expirationSeconds());

        try {
            JsonNode response = http.post().uri(props.intentionUrl())
                    .header("Authorization", "Token " + props.secretKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(JsonNode.class);
            String clientSecret = response == null ? "" : response.path("client_secret").asText("");
            String orderId = response == null ? "" : response.path("intention_order_id").asText("");
            if (clientSecret.isEmpty() || orderId.isEmpty()) {
                log.error("Paymob intention response had no client_secret or intention_order_id");
                throw unavailable();
            }
            return new Intention(clientSecret, orderId);
        } catch (RestClientException e) {
            // The exception text can contain the response body but never our key (it is only in a request header).
            log.error("Paymob intention call failed: {}", e.getMessage());
            throw unavailable();
        }
    }

    private static ApiException unavailable() {
        return new ApiException(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR",
                "We could not reach the payment provider. Please try again.");
    }
}
