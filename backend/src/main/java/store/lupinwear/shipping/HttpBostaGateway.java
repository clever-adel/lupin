package store.lupinwear.shipping;

import com.fasterxml.jackson.databind.JsonNode;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;
import java.util.ArrayList;
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
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.client.RestClientException;
import store.lupinwear.shared.ApiException;

/**
 * Bosta API v2, written from Bosta's public documentation (docs.bosta.co: "Create your first delivery",
 * "Format Bosta address", "Get your API key", "Get delivery status via webhook"), read 2026-11-12.
 * The district list is a public call. Creating deliveries needs the merchant's API key and has NOT been
 * run against a real Bosta account yet (IMPLEMENTATION_STATUS.md).
 */
@Component
public class HttpBostaGateway implements BostaGateway {

    private static final Logger log = LoggerFactory.getLogger(HttpBostaGateway.class);

    private final BostaProperties props;
    private final RestClient http;
    private final Cache<String, List<District>> districts = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofHours(12)).maximumSize(64).build();

    public HttpBostaGateway(BostaProperties props) {
        this.props = props;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(20));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    @Override
    public List<District> districts(String bostaCityId) {
        return districts.get(bostaCityId, id -> {
            try {
                JsonNode body = http.get().uri(props.baseUrl() + "/cities/{id}/districts", id)
                        .retrieve().body(JsonNode.class);
                List<District> list = new ArrayList<>();
                if (body != null) {
                    for (JsonNode d : body.path("data")) {
                        list.add(new District(d.path("districtId").asText(), d.path("districtName").asText(),
                                d.path("districtOtherName").asText(""), d.path("dropOffAvailability").asBoolean(true)));
                    }
                }
                return List.copyOf(list);
            } catch (RestClientException e) {
                log.warn("Bosta district list unavailable: {}", e.getMessage());
                throw unavailable("We could not load Bosta's districts. Please try again.");
            }
        });
    }

    @Override
    public Created createDelivery(NewDelivery d) {
        if (!props.configured()) {
            throw unavailable("Bosta is not set up on the server.");
        }
        Map<String, Object> address = new LinkedHashMap<>();
        address.put("city", d.cityName());
        address.put("districtId", d.districtId());
        address.put("firstLine", d.addressLine());
        if (d.landmark() != null) {
            address.put("secondLine", d.landmark());
        }
        Map<String, Object> receiver = new LinkedHashMap<>();
        receiver.put("firstName", d.firstName());
        receiver.put("lastName", d.lastName());
        receiver.put("phone", d.phone());
        if (d.email() != null) {
            receiver.put("email", d.email());
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", 10); // Deliver
        body.put("specs", Map.of("packageType", d.packageType(),
                "packageDetails", Map.of("description", d.packageDescription(), "itemsCount", d.itemsCount())));
        body.put("cod", d.cod());
        body.put("dropOffAddress", address);
        body.put("receiver", receiver);
        body.put("businessReference", d.businessReference());
        // Opening the parcel at the door would require photos of its contents (Bosta error 2150).
        body.put("allowToOpenPackage", false);
        if (d.notes() != null) {
            body.put("notes", d.notes());
        }
        if (d.businessLocationId() != null) {
            body.put("businessLocationId", d.businessLocationId());
        }
        body.put("webhookUrl", d.webhookUrl());
        body.put("webhookCustomHeaders", Map.of(d.webhookHeader(), d.webhookSecret()));

        try {
            JsonNode response = http.post().uri(props.baseUrl() + "/deliveries?apiVersion=1")
                    .header("Authorization", props.apiKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(JsonNode.class);
            // Bosta wraps results as {success, message, data}; accept the bare form as well.
            JsonNode data = response == null ? null : (response.has("data") ? response.path("data") : response);
            String id = data == null ? "" : data.path("_id").asText("");
            String tracking = data == null ? "" : data.path("trackingNumber").asText("");
            if (id.isEmpty() || tracking.isEmpty()) {
                log.error("Bosta create-delivery response had no _id or trackingNumber");
                throw unavailable("Bosta did not confirm the delivery. Check the Bosta dashboard before trying again.");
            }
            return new Created(id, tracking);
        } catch (RestClientResponseException e) {
            // Bosta explains what is wrong (e.g. 3001 City Not Found, 3003 District Not Found); pass that on.
            String message = "";
            try {
                JsonNode err = e.getResponseBodyAs(JsonNode.class);
                message = err == null ? "" : err.path("message").asText("");
            } catch (RuntimeException ignored) {
                // Not JSON.
            }
            log.warn("Bosta refused the delivery: HTTP {} {}", e.getStatusCode().value(), message);
            int status = e.getStatusCode().value();
            if (status == 401 || status == 403) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "BOSTA_KEY_REJECTED",
                        "Bosta did not accept the API key. Check BOSTA_API_KEY on the server (it needs Read/Write"
                                + " permission). Nothing was sent.");
            }
            throw new ApiException(HttpStatus.BAD_GATEWAY, "BOSTA_REJECTED",
                    "Bosta refused this delivery" + (message.isBlank() ? "." : ": " + message));
        } catch (RestClientException e) {
            log.error("Bosta create-delivery call failed: {}", e.getMessage());
            throw unavailable("We could not reach Bosta. Check the Bosta dashboard before trying again.");
        }
    }

    private static ApiException unavailable(String message) {
        return new ApiException(HttpStatus.BAD_GATEWAY, "BOSTA_UNAVAILABLE", message);
    }
}
