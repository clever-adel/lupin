package store.lupinwear.catalog.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;

public final class CatalogDtos {

    private CatalogDtos() {
    }

    // ── public read models ──

    public record CategoryView(String slug, String nameEn, String nameAr, String parentSlug) {
    }

    /** {@code imageUrl}: the main photo of the department's first piece in the store order; null if none. */
    /**
     * {@code imageUrl} is the card photo: the owner's upload, else the main photo of the first piece.
     * {@code ownImageUrl} is the owner's upload alone; {@code pieceImageUrls} the main photos of the first
     * pieces in the store order, which the home page card shows in turn. {@code ownImagePublicId} is for the
     * dashboard only.
     */
    public record DepartmentView(String slug, String nameEn, String nameAr, String status, long productCount,
            List<CategoryView> categories, String imageUrl, String ownImageUrl, List<String> pieceImageUrls,
            String ownImagePublicId) {
    }

    /** {@code hoverImageUrl} is the colour's second photo, shown when a shopper points at the card; null if there is one. */
    public record ColorDot(String nameEn, String nameAr, String hex, String imageUrl, String hoverImageUrl) {
    }

    public record ProductCard(String slug, String nameEn, String nameAr, String categoryEn, String categoryAr,
            BigDecimal price, BigDecimal salePrice, Integer discountPercent, String badge, String badgeEn,
            String badgeAr, boolean inStock, List<ColorDot> colors) {
    }

    public record ImageView(String url, String altEn, String altAr, Integer width, Integer height) {
    }

    public record VariantView(long id, String sizeCode, boolean available, int maxQuantity) {
    }

    public record ColorView(long id, String nameEn, String nameAr, String hex, boolean main, List<ImageView> images,
            List<VariantView> variants) {
    }

    public record Crumb(String slug, String nameEn, String nameAr) {
    }

    public record ProductDetail(long id, String slug, String nameEn, String nameAr, String descriptionEn,
            String descriptionAr, String fabricEn, String fabricAr, String fitEn, String fitAr, String brand,
            String badge, String badgeEn, String badgeAr, BigDecimal price, BigDecimal salePrice,
            Integer discountPercent, Crumb department,
            Crumb category, List<ColorView> colors, SizeGuide sizeGuide) {
    }

    /**
     * A product's size chart, in cm. BODY charts give the wearer's measurements, GARMENT charts the piece's own.
     * Each row is one measurement with a value per size code ("94-102", "58"); sizes left out show a dash.
     */
    public record SizeGuide(@NotNull @Pattern(regexp = "BODY|GARMENT") String kind,
            @NotEmpty @Size(max = 8) List<@Valid @NotNull SizeGuideRow> rows,
            @Size(max = 240) String noteEn, @Size(max = 240) String noteAr) {
    }

    public record SizeGuideRow(@NotBlank @Size(max = 40) String labelEn, @NotBlank @Size(max = 40) String labelAr,
            @NotNull @Size(max = 12) java.util.Map<@NotBlank @Size(max = 12) String, @NotNull @Size(max = 20) String> values) {
    }

    /** A bag line as the server sees it right now: current price and current availability. */
    public record VariantLine(long variantId, String productSlug, String nameEn, String nameAr, String colorEn,
            String colorAr, String sizeCode, String imageUrl, BigDecimal unitPrice, boolean available,
            int maxQuantity) {
    }

    public record Facets(List<String> sizes, List<ColorDot> colors, BigDecimal minPrice, BigDecimal maxPrice) {
    }

    // ── admin write models ──

    /** An uploaded photo (served under /media/), or both empty to go back to the first piece's photo. */
    public record DepartmentPhotoRequest(@Size(max = 300) String imageUrl, @Size(max = 200) String imagePublicId) {
    }

    public record DepartmentStatusRequest(@NotNull @Pattern(regexp = "ACTIVE|COMING_SOON|HIDDEN") String status) {
    }

    public record CategoryRenameRequest(@NotBlank @Size(max = 80) String nameEn, @NotBlank @Size(max = 80) String nameAr) {
    }

    public record CategoryRequest(
            @NotBlank String departmentSlug,
            String parentSlug,
            @NotBlank @Size(max = 80) String nameEn,
            @NotBlank @Size(max = 80) String nameAr) {
    }

    public record ImageRequest(
            @NotBlank @Size(max = 255) String publicId,
            @NotBlank @Size(max = 600) @Pattern(regexp = "^(https://.*|/media/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpg|png|webp|avif))$") String url,
            @Size(max = 200) String altEn,
            @Size(max = 200) String altAr) {
    }

    public record ColorRequest(
            @NotBlank @Size(max = 60) String nameEn,
            @NotBlank @Size(max = 60) String nameAr,
            @NotBlank @Pattern(regexp = "^#[0-9A-Fa-f]{6}$") String hex,
            boolean main,
            @Size(max = 10, message = "A colour can have at most 10 photos") List<@Valid ImageRequest> images) {
    }

    public record ProductRequest(
            @NotBlank @Size(max = 160) String nameEn,
            @NotBlank @Size(max = 160) String nameAr,
            @NotBlank String departmentSlug,
            @NotBlank String categorySlug,
            @Size(max = 5000) String descriptionEn,
            @Size(max = 5000) String descriptionAr,
            @Size(max = 300) String fabricEn,
            @Size(max = 300) String fabricAr,
            @Size(max = 300) String fitEn,
            @Size(max = 300) String fitAr,
            @Size(max = 80) String brand,
            @Pattern(regexp = BADGES) String badge,
            @Size(max = 30) String badgeEn,
            @Size(max = 30) String badgeAr,
            @NotNull @DecimalMin("0.01") @Digits(integer = 10, fraction = 2) BigDecimal price,
            @DecimalMin("0.01") @Digits(integer = 10, fraction = 2) BigDecimal salePrice,
            @Pattern(regexp = "ADULT|KIDS") String sizeGroup,
            @NotEmpty List<@NotBlank String> sizes,
            @NotEmpty List<@Valid ColorRequest> colors,
            @Min(0) @Max(100000) Integer initialStockPerVariant,
            @Size(max = 144) List<@Valid InitialVariantStock> stockByVariant) {

        /** Keeps existing internal clients working; the dashboard sends explicit per-variant stock. */
        public ProductRequest(String nameEn, String nameAr, String departmentSlug, String categorySlug,
                String descriptionEn, String descriptionAr, String fabricEn, String fabricAr, String fitEn,
                String fitAr, String brand, String badge, BigDecimal price, BigDecimal salePrice, String sizeGroup,
                List<String> sizes, List<ColorRequest> colors, Integer initialStockPerVariant) {
            this(nameEn, nameAr, departmentSlug, categorySlug, descriptionEn, descriptionAr, fabricEn, fabricAr,
                    fitEn, fitAr, brand, badge, null, null, price, salePrice, sizeGroup, sizes, colors,
                    initialStockPerVariant, List.of());
        }
    }

    /** Labels on the product photo. CUSTOM uses the owner's own English and Arabic text. */
    public static final String BADGES = "NEW|BESTSELLER|SALE|CUSTOM";

    public record InitialVariantStock(
            @NotNull @Min(0) @Max(11) Integer colorIndex,
            @NotBlank @Size(max = 12) String sizeCode,
            @NotNull @Min(0) @Max(100000) Integer quantity) {
    }

    public record ProductCreated(long id, String slug, List<Long> variantIds) {
    }

    public record ProductStatusRequest(@NotNull @Pattern(regexp = "DRAFT|ACTIVE|ARCHIVED") String status) {
    }

    public record StockAdjustRequest(@NotNull @Min(-100000) @Max(100000) Integer delta, @Size(max = 300) String note) {
    }

    public record StockView(long variantId, int onHand, int reserved, int available) {
    }

    /** The parts of a product staff can change after creating it. Colours and sizes are fixed for now. */
    public record ProductUpdateRequest(
            @NotBlank @Size(max = 160) String nameEn,
            @NotBlank @Size(max = 160) String nameAr,
            @NotBlank String categorySlug,
            @Size(max = 5000) String descriptionEn,
            @Size(max = 5000) String descriptionAr,
            @Size(max = 300) String fabricEn,
            @Size(max = 300) String fabricAr,
            @Size(max = 300) String fitEn,
            @Size(max = 300) String fitAr,
            /** Who made the piece (e.g. Bershka). Empty means unknown; it is then left out of search markup. */
            @Size(max = 80) String brand,
            @Pattern(regexp = BADGES) String badge,
            @Size(max = 30) String badgeEn,
            @Size(max = 30) String badgeAr,
            @NotNull @DecimalMin("0.01") @Digits(integer = 10, fraction = 2) BigDecimal price,
            @DecimalMin("0.01") @Digits(integer = 10, fraction = 2) BigDecimal salePrice,
            boolean featured) {
    }

    public record ColorImagesRequest(
            @NotNull @Size(max = 10, message = "A colour can have at most 10 photos") List<@Valid ImageRequest> images) {
    }

    public record AdminImage(long id, String publicId, String url, String altEn, String altAr) {
    }

    public record AdminColor(long id, String nameEn, String nameAr, String hex, List<AdminImage> images, boolean main) {
    }

    public record AdminProductDetail(long id, String slug, String status, String departmentSlug,
            String categorySlug, String nameEn, String nameAr, String descriptionEn, String descriptionAr,
            String fabricEn, String fabricAr, String fitEn, String fitAr, String brand, String badge, String badgeEn,
            String badgeAr, BigDecimal price, BigDecimal salePrice, boolean featured, List<AdminColor> colors,
            /** The product's sizes, in size order: a colour added later gets one variant for each. */
            List<String> sizes, SizeGuide sizeGuide,
            /** Every colour and size with its stock, in colour then size order. */
            List<AdminVariantRow> variants) {
    }

    /** Adds a size to every colour of a product that already exists, each with its starting stock. */
    public record AddSizeRequest(
            @NotBlank @Size(max = 12) String sizeCode,
            /** Starting stock per colour id; a colour left out starts at 0. */
            java.util.Map<@NotNull Long, @NotNull @Min(0) @Max(100000) Integer> stockByColor) {
    }

    public record SizeAdded(List<Long> variantIds) {
    }

    /** Product ids in the order they should appear on the store, first to last. */
    public record DisplayOrderRequest(@jakarta.validation.constraints.NotEmpty
            @Size(max = 500) List<@NotNull Long> productIds) {
    }

    /** A colour added to a product that already exists: same sizes as the others, its own stock and photos. */
    public record AddColorRequest(
            @NotBlank @Size(max = 60) String nameEn,
            @NotBlank @Size(max = 60) String nameAr,
            @NotBlank @Pattern(regexp = "^#[0-9A-Fa-f]{6}$") String hex,
            @Size(max = 10, message = "A colour can have at most 10 photos") List<@Valid ImageRequest> images,
            /** Starting stock per size code; a size left out starts at 0. */
            java.util.Map<@NotBlank String, @NotNull @Min(0) @Max(100000) Integer> stockBySize) {
    }

    public record ColorAdded(long colorId, List<Long> variantIds) {
    }

    /** Edits a colour's names and shade; {@code main: true} makes it the colour shoppers see first. */
    public record ColorUpdateRequest(
            @NotBlank @Size(max = 60) String nameEn,
            @NotBlank @Size(max = 60) String nameAr,
            @NotBlank @Pattern(regexp = "^#[0-9A-Fa-f]{6}$") String hex,
            boolean main) {
    }

    public record AdminVariantRow(long variantId, String color, String sizeCode, String sku, int onHand,
            int reserved, int available) {
    }

    public record AdminProductRow(long id, String slug, String nameEn, String nameAr, String status,
            BigDecimal price, BigDecimal salePrice, List<AdminVariantRow> variants) {
    }
}
