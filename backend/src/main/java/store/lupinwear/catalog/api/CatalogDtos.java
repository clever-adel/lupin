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

    public record DepartmentView(String slug, String nameEn, String nameAr, String status, long productCount,
            List<CategoryView> categories) {
    }

    public record ColorDot(String nameEn, String nameAr, String hex, String imageUrl) {
    }

    public record ProductCard(String slug, String nameEn, String nameAr, String categoryEn, String categoryAr,
            BigDecimal price, BigDecimal salePrice, Integer discountPercent, String badge, boolean inStock,
            List<ColorDot> colors) {
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
            String badge, BigDecimal price, BigDecimal salePrice, Integer discountPercent, Crumb department,
            Crumb category, List<ColorView> colors) {
    }

    /** A bag line as the server sees it right now: current price and current availability. */
    public record VariantLine(long variantId, String productSlug, String nameEn, String nameAr, String colorEn,
            String colorAr, String sizeCode, String imageUrl, BigDecimal unitPrice, boolean available,
            int maxQuantity) {
    }

    public record Facets(List<String> sizes, List<ColorDot> colors, BigDecimal minPrice, BigDecimal maxPrice) {
    }

    // ── admin write models ──

    public record DepartmentStatusRequest(@NotNull @Pattern(regexp = "ACTIVE|COMING_SOON|HIDDEN") String status) {
    }

    public record CategoryRequest(
            @NotBlank String departmentSlug,
            String parentSlug,
            @NotBlank @Size(max = 80) String nameEn,
            @NotBlank @Size(max = 80) String nameAr) {
    }

    public record ImageRequest(
            @NotBlank @Size(max = 255) String publicId,
            @NotBlank @Size(max = 600) @Pattern(regexp = "^https://.*") String url,
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
            @Pattern(regexp = "NEW|BESTSELLER") String badge,
            @NotNull @DecimalMin("0.01") @Digits(integer = 10, fraction = 2) BigDecimal price,
            @DecimalMin("0.01") @Digits(integer = 10, fraction = 2) BigDecimal salePrice,
            @Pattern(regexp = "ADULT|KIDS") String sizeGroup,
            @NotEmpty List<@NotBlank String> sizes,
            @NotEmpty List<@Valid ColorRequest> colors,
            @Min(0) @Max(100000) Integer initialStockPerVariant) {
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
            @Pattern(regexp = "NEW|BESTSELLER") String badge,
            @NotNull @DecimalMin("0.01") @Digits(integer = 10, fraction = 2) BigDecimal price,
            @DecimalMin("0.01") @Digits(integer = 10, fraction = 2) BigDecimal salePrice,
            boolean featured) {
    }

    public record AdminProductDetail(long id, String slug, String status, String departmentSlug,
            String categorySlug, String nameEn, String nameAr, String descriptionEn, String descriptionAr,
            String fabricEn, String fabricAr, String fitEn, String fitAr, String badge, BigDecimal price,
            BigDecimal salePrice, boolean featured) {
    }

    public record AdminVariantRow(long variantId, String color, String sizeCode, String sku, int onHand,
            int reserved, int available) {
    }

    public record AdminProductRow(long id, String slug, String nameEn, String nameAr, String status,
            BigDecimal price, BigDecimal salePrice, List<AdminVariantRow> variants) {
    }
}
