package store.lupinwear.shop;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** Shop counter models. Mirrored in frontend/app/features/admin/shop.ts. */
public final class ShopDtos {

    private ShopDtos() {
    }

    /** One size of one colour, with what is free to sell right now and the online price as a hint. */
    public record Piece(long variantId, long productId, String productName, String productNameAr, String color,
            String colorHex, String sizeCode, String sku, BigDecimal onlinePrice, int available, String status,
            String imageUrl) {
    }

    /**
     * For a sale: variantId, or a description for something not on the site (money only, no stock).
     * For a return: originalItemId (a line of the earlier receipt), variantId, or a description.
     */
    public record LineRequest(Long variantId, Long originalItemId, @Size(max = 160) String description,
            @NotNull @Min(1) @Max(1000) Integer quantity,
            @NotNull @DecimalMin("0.00") @DecimalMax("1000000.00") @Digits(integer = 10, fraction = 2) BigDecimal unitPrice) {
    }

    public record SaleRequest(@Size(max = 20) String paymentMethod, @Size(max = 120) String customerName,
            @Size(max = 30) String customerPhone, @Size(max = 300) String note,
            @NotEmpty @Size(max = 50) List<@Valid @NotNull LineRequest> items) {
    }

    public record ReturnRequest(Long originalSaleId, @Size(max = 20) String paymentMethod, @Size(max = 300) String note,
            @NotEmpty @Size(max = 50) List<@Valid @NotNull LineRequest> items) {
    }

    /**
     * {@code returned} is how many of this line have come back since (sales only). {@code custom}: something not
     * on the site, typed in by staff; productName holds what they wrote, and colour, size and SKU are empty.
     */
    public record ReceiptLine(long id, Long variantId, Long productId, String productName, String color,
            String sizeCode, String sku, int quantity, BigDecimal unitPrice, Long originalItemId, int returned,
            String imageUrl, boolean custom) {
    }

    public record Receipt(long id, String kind, Long originalSaleId, String paymentMethod, BigDecimal total,
            String customerName, String customerPhone, String note, String staffName, Instant createdAt,
            List<ReceiptLine> items, List<Long> returnIds) {
    }

    public record Totals(BigDecimal sales, BigDecimal returns, BigDecimal net, int receipts, int piecesSold,
            int piecesReturned) {
    }

    public record ShopSummary(Totals today, Totals month) {
    }
}
