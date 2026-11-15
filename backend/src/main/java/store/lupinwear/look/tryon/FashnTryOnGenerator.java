package store.lupinwear.look.tryon;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * FASHN (https://docs.fashn.ai). The first garment is put on a generated model with
 * {@code product-to-model}; every further garment is dressed onto that result with {@code tryon-v1.6},
 * so the final image only shows garments that came from our own product photos.
 */
public class FashnTryOnGenerator implements TryOnGenerator {

    private static final Logger log = LoggerFactory.getLogger(FashnTryOnGenerator.class);
    private static final Duration STEP_TIMEOUT = Duration.ofMinutes(4);
    private static final Duration POLL_EVERY = Duration.ofMillis(2500);
    static final String MODEL_PROMPT = "Full-body fashion photograph of an adult male model, head to toe in frame, "
            + "standing in a relaxed natural pose, facing the camera. Clean seamless off-white studio backdrop, "
            + "soft even lighting, premium minimalist menswear editorial. The garment must keep its exact colour, "
            + "fabric, cut, print and logo.";

    private final TryOnProperties props;
    private final RestClient http;

    public FashnTryOnGenerator(TryOnProperties props) {
        this.props = props;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(10));
        factory.setReadTimeout(Duration.ofSeconds(60));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    @Override
    public String provider() {
        return "FASHN";
    }

    @Override
    public List<Image> generate(List<Garment> garments, int candidates) {
        if (garments.isEmpty()) {
            throw new TryOnException("The look has no garment the model can wear.");
        }
        Garment base = garments.getFirst();
        Map<String, Object> first = new LinkedHashMap<>();
        first.put("product_image", dataUri(base.photo()));
        first.put("prompt", MODEL_PROMPT);
        first.put("aspect_ratio", "2:3");
        first.put("num_images", candidates);
        first.put("output_format", "jpeg");
        List<String> images = run("product-to-model", first);

        for (Garment garment : garments.subList(1, garments.size())) {
            List<String> dressed = new ArrayList<>();
            for (String model : images) {
                Map<String, Object> inputs = new LinkedHashMap<>();
                inputs.put("model_image", model);
                inputs.put("garment_image", dataUri(garment.photo()));
                inputs.put("category", category(garment.role()));
                inputs.put("mode", "quality");
                inputs.put("num_samples", 1);
                inputs.put("output_format", "jpeg");
                dressed.add(run("tryon-v1.6", inputs).getFirst());
            }
            images = dressed;
        }
        return images.stream().map(this::download).toList();
    }

    static String category(String role) {
        return switch (role) {
            case "BOTTOM" -> "bottoms";
            case "ONE_PIECE" -> "one-pieces";
            default -> "tops";
        };
    }

    private List<String> run(String model, Map<String, Object> inputs) {
        JsonNode started;
        try {
            started = http.post().uri(props.baseUrl() + "/run")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + props.fashnApiKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("model_name", model, "inputs", inputs))
                    .retrieve().body(JsonNode.class);
        } catch (RestClientException e) {
            log.warn("FASHN {} could not start: {}", model, e.getMessage());
            throw new TryOnException("The AI service refused the request. Check the FASHN key and credits.", e);
        }
        String id = started == null ? null : started.path("id").asText(null);
        if (id == null) {
            throw new TryOnException("The AI service did not accept the request: " + errorText(started));
        }
        Instant deadline = Instant.now().plus(STEP_TIMEOUT);
        while (Instant.now().isBefore(deadline)) {
            sleep();
            JsonNode status;
            try {
                status = http.get().uri(props.baseUrl() + "/status/" + id)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + props.fashnApiKey())
                        .retrieve().body(JsonNode.class);
            } catch (RestClientException e) {
                log.warn("FASHN status check failed for {}: {}", id, e.getMessage());
                continue;
            }
            if (status == null) {
                continue;
            }
            switch (status.path("status").asText()) {
                case "completed" -> {
                    List<String> out = new ArrayList<>();
                    status.path("output").forEach(n -> out.add(n.asText()));
                    if (out.isEmpty()) {
                        throw new TryOnException("The AI service finished without an image.");
                    }
                    return out;
                }
                case "failed" -> throw new TryOnException("The AI service could not make this image: "
                        + errorText(status) + ". Try a clearer product photo (front view, whole garment).");
                default -> {
                    // starting, in_queue, processing: keep waiting
                }
            }
        }
        throw new TryOnException("The AI service took too long. Try again in a few minutes.");
    }

    private Image download(String url) {
        if (url.startsWith("data:")) {
            int comma = url.indexOf(',');
            String type = url.substring(5, url.indexOf(';'));
            return new Image(Base64.getDecoder().decode(url.substring(comma + 1)), type);
        }
        if (!url.startsWith("https://")) {
            throw new TryOnException("The AI service returned an unexpected image address.");
        }
        try {
            byte[] bytes = http.get().uri(url).retrieve().body(byte[].class);
            if (bytes == null || bytes.length == 0) {
                throw new TryOnException("The finished image could not be downloaded.");
            }
            return new Image(bytes, bytes.length > 3 && (bytes[0] & 0xff) == 0x89 ? "image/png" : "image/jpeg");
        } catch (RestClientException e) {
            throw new TryOnException("The finished image could not be downloaded.", e);
        }
    }

    private static String dataUri(Image image) {
        return "data:" + image.contentType() + ";base64," + Base64.getEncoder().encodeToString(image.bytes());
    }

    private static String errorText(JsonNode node) {
        if (node == null) {
            return "no answer";
        }
        JsonNode error = node.path("error");
        if (error.isObject()) {
            return (error.path("name").asText("") + " " + error.path("message").asText("")).trim();
        }
        String text = error.asText(node.path("message").asText("unknown error"));
        return text.length() > 200 ? text.substring(0, 200) : text;
    }

    private static void sleep() {
        try {
            Thread.sleep(POLL_EVERY);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new TryOnException("Stopped while waiting for the AI service.");
        }
    }
}
