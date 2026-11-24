package store.lupinwear.shop;

import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.shared.PageResponse;
import store.lupinwear.shop.ShopDtos.Piece;
import store.lupinwear.shop.ShopDtos.Receipt;
import store.lupinwear.shop.ShopDtos.ReturnRequest;
import store.lupinwear.shop.ShopDtos.SaleRequest;
import store.lupinwear.shop.ShopDtos.ShopSummary;

/** The shop counter: in-person sales and returns at the shop's own prices, from the same stock. */
@RestController
@RequestMapping("/api/v1/admin/shop")
@PreAuthorize("hasAnyRole('ADMIN','OWNER')")
public class AdminShopController {

    private final ShopService shop;

    public AdminShopController(ShopService shop) {
        this.shop = shop;
    }

    @GetMapping("/pieces")
    public List<Piece> pieces(@RequestParam(required = false) String q) {
        return shop.pieces(q);
    }

    @GetMapping("/summary")
    public ShopSummary summary() {
        return shop.summary();
    }

    @GetMapping("/sales")
    public PageResponse<Receipt> list(@RequestParam(required = false) String kind,
            @RequestParam(required = false) String day, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int pageSize) {
        return shop.list(kind, day, null, page, pageSize);
    }

    @GetMapping("/sales/{id}")
    public Receipt receipt(@PathVariable long id) {
        return shop.receipt(id);
    }

    @PostMapping("/sales")
    @ResponseStatus(HttpStatus.CREATED)
    public Receipt sell(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody SaleRequest body) {
        return shop.sell(user.id(), body);
    }

    @PostMapping("/returns")
    @ResponseStatus(HttpStatus.CREATED)
    public Receipt giveBack(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody ReturnRequest body) {
        return shop.giveBack(user.id(), body);
    }
}
