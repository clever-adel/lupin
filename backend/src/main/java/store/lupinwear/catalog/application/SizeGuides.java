package store.lupinwear.catalog.application;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import store.lupinwear.catalog.api.CatalogDtos.SizeGuide;

/** Turns the products.size_guide column into a {@link SizeGuide} and back. */
final class SizeGuides {

    private static final ObjectMapper JSON = new ObjectMapper();

    private SizeGuides() {
    }

    static SizeGuide read(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return JSON.readValue(json, SizeGuide.class);
        } catch (JsonProcessingException e) {
            // A chart that no longer reads is left out rather than breaking the product page.
            return null;
        }
    }

    static String write(SizeGuide guide) {
        try {
            return JSON.writeValueAsString(guide);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Size guide could not be written", e);
        }
    }
}
