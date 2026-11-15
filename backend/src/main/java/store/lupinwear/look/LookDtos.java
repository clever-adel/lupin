package store.lupinwear.look;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import store.lupinwear.catalog.api.CatalogDtos.ProductCard;
import store.lupinwear.catalog.api.CatalogDtos.VariantView;

public final class LookDtos {

    private LookDtos() {
    }

    // ── public read models ──

    /** A look in a list or switcher. {@code total} is what the whole look costs today. */
    public record LookCard(String slug, String titleEn, String titleAr, String imageUrl, boolean aiGenerated,
            int itemCount, BigDecimal total) {
    }

    /** One colour of a look item, with its sizes and live availability. */
    public record LookColor(long id, String nameEn, String nameAr, String hex, String imageUrl,
            List<VariantView> variants) {
    }

    /**
     * One product the model wears. {@code colorId} is the colour in the photo; {@code colors} lists
     * every colour of the product so a shopper can choose another one.
     */
    public record LookItem(String productSlug, String nameEn, String nameAr, String categoryEn, String categoryAr,
            String role, BigDecimal price, BigDecimal salePrice, Integer discountPercent, String descriptionEn,
            String descriptionAr, String fabricEn, String fabricAr, String fitEn, String fitAr, long colorId,
            boolean inStock, List<LookColor> colors) {
    }

    /**
     * {@code total} and {@code fullPrice} are sums of today's prices for the colours in the photo.
     * {@code pairsWith} are other products that go with the look; {@code otherLooks} the alternatives.
     */
    public record LookDetail(String slug, String titleEn, String titleAr, String descriptionEn, String descriptionAr,
            String imageUrl, boolean aiGenerated, List<LookItem> items, BigDecimal total, BigDecimal fullPrice,
            List<ProductCard> pairsWith, List<LookCard> otherLooks) {
    }

    // ── staff ──

    public record LookItemRequest(
            @NotNull Long productId,
            @NotNull Long colorId,
            @NotNull @Pattern(regexp = "TOP|BOTTOM|ONE_PIECE|OUTER|ACCESSORY") String role) {
    }

    public record LookRequest(
            @NotBlank @Size(max = 120) String titleEn,
            @NotBlank @Size(max = 120) String titleAr,
            @Size(max = 600) String descriptionEn,
            @Size(max = 600) String descriptionAr,
            @Min(0) @Max(10000) Integer sortOrder,
            @NotNull @Size(min = 1, max = 8, message = "A look has between 1 and 8 items") List<@Valid LookItemRequest> items) {
    }

    public record LookImageRequest(
            @NotBlank @Size(max = 255) String publicId,
            @NotBlank @Pattern(regexp = "^/media/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpg|png|webp|avif)$",
                    message = "The photo must be uploaded from the dashboard") String url,
            @NotNull @Pattern(regexp = "AI|PHOTO") String source) {
    }

    public record LookStatusRequest(@NotNull @Pattern(regexp = "DRAFT|PUBLISHED") String status) {
    }

    public record AdminLookRow(long id, String slug, String titleEn, String titleAr, String status, String imageUrl,
            String imageSource, int itemCount, int sortOrder) {
    }

    /** {@code productStatus} lets staff see that a draft or archived product hides an item from shoppers. */
    public record AdminLookItem(long productId, String productNameEn, String productStatus, long colorId,
            String colorNameEn, String colorHex, String imageUrl, String role, String categoryEn) {
    }

    public record AdminLookDetail(long id, String slug, String titleEn, String titleAr, String descriptionEn,
            String descriptionAr, String status, String imageUrl, String imagePublicId, String imageSource,
            int sortOrder, List<AdminLookItem> items) {
    }

    public record LookCreated(long id, String slug) {
    }

    /** {@code provider} is FASHN for the real service, LOCAL_PREVIEW for the labelled test images. */
    public record AiStatus(boolean available, String provider, int candidates) {
    }

    public record GenerationView(UUID id, String status, String provider, String error, int candidateCount,
            Instant createdAt, Instant finishedAt) {
    }
}
