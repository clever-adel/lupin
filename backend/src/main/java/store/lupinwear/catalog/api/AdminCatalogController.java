package store.lupinwear.catalog.api;

import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.catalog.api.CatalogDtos.CategoryRequest;
import store.lupinwear.catalog.api.CatalogDtos.DepartmentStatusRequest;
import store.lupinwear.catalog.api.CatalogDtos.ProductCreated;
import store.lupinwear.catalog.api.CatalogDtos.ProductRequest;
import store.lupinwear.catalog.api.CatalogDtos.ProductStatusRequest;
import store.lupinwear.catalog.api.CatalogDtos.StockAdjustRequest;
import store.lupinwear.catalog.api.CatalogDtos.StockView;
import store.lupinwear.catalog.application.CatalogAdminService;
import store.lupinwear.security.CurrentUser;

/** Staff only. Guarded twice: the /api/v1/admin/** URL rule and the class-level role check. */
@RestController
@RequestMapping("/api/v1/admin")
@PreAuthorize("hasAnyRole('ADMIN','OWNER')")
public class AdminCatalogController {

    private final CatalogAdminService catalog;

    public AdminCatalogController(CatalogAdminService catalog) {
        this.catalog = catalog;
    }

    @PatchMapping("/departments/{slug}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void departmentStatus(@AuthenticationPrincipal CurrentUser user, @PathVariable String slug,
            @Valid @RequestBody DepartmentStatusRequest body) {
        catalog.setDepartmentStatus(user.id(), slug, body.status());
    }

    @PostMapping("/categories")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String, String> createCategory(@AuthenticationPrincipal CurrentUser user,
            @Valid @RequestBody CategoryRequest body) {
        return Map.of("slug", catalog.createCategory(user.id(), body));
    }

    @PostMapping("/products")
    @ResponseStatus(HttpStatus.CREATED)
    ProductCreated createProduct(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody ProductRequest body) {
        return catalog.createProduct(user.id(), body);
    }

    @PatchMapping("/products/{id}/status")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void productStatus(@AuthenticationPrincipal CurrentUser user, @PathVariable long id,
            @Valid @RequestBody ProductStatusRequest body) {
        catalog.setProductStatus(user.id(), id, body.status());
    }

    @GetMapping("/products")
    store.lupinwear.shared.PageResponse<store.lupinwear.catalog.api.CatalogDtos.AdminProductRow> products(
            @org.springframework.web.bind.annotation.RequestParam(required = false) String q,
            @org.springframework.web.bind.annotation.RequestParam(required = false) String status,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "0") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "20") int pageSize) {
        return catalog.products(q == null ? null : q.substring(0, Math.min(q.length(), 80)), status, page, pageSize);
    }

    @GetMapping("/products/{id}")
    CatalogDtos.AdminProductDetail product(@PathVariable long id) {
        return catalog.productForEdit(id);
    }

    @org.springframework.web.bind.annotation.PutMapping("/products/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void updateProduct(@AuthenticationPrincipal CurrentUser user, @PathVariable long id,
            @Valid @RequestBody CatalogDtos.ProductUpdateRequest body) {
        catalog.updateProduct(user.id(), id, body);
    }

    @GetMapping("/inventory/{variantId}")
    StockView stock(@PathVariable long variantId) {
        return catalog.stock(variantId);
    }

    @PostMapping("/inventory/{variantId}/adjust")
    StockView adjustStock(@AuthenticationPrincipal CurrentUser user, @PathVariable long variantId,
            @Valid @RequestBody StockAdjustRequest body) {
        return catalog.adjustStock(user.id(), variantId, body.delta(), body.note());
    }
}
