package store.lupinwear.catalog.api;

import java.math.BigDecimal;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.catalog.api.CatalogDtos.DepartmentView;
import store.lupinwear.catalog.api.CatalogDtos.Facets;
import store.lupinwear.catalog.api.CatalogDtos.ProductCard;
import store.lupinwear.catalog.api.CatalogDtos.ProductDetail;
import store.lupinwear.catalog.api.CatalogDtos.VariantLine;
import store.lupinwear.catalog.application.CatalogQueryService;
import store.lupinwear.catalog.application.CatalogQueryService.ProductFilter;
import store.lupinwear.catalog.application.CatalogQueryService.Sort;
import store.lupinwear.shared.PageResponse;

@RestController
@RequestMapping("/api/v1/catalog")
public class CatalogController {

    private final CatalogQueryService catalog;

    public CatalogController(CatalogQueryService catalog) {
        this.catalog = catalog;
    }

    @GetMapping("/departments")
    List<DepartmentView> departments() {
        return catalog.departments();
    }

    @GetMapping("/products")
    PageResponse<ProductCard> products(
            @RequestParam(required = false) String department,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) List<String> size,
            @RequestParam(required = false) List<String> color,
            @RequestParam(required = false) BigDecimal minPrice,
            @RequestParam(required = false) BigDecimal maxPrice,
            @RequestParam(defaultValue = "false") boolean sale,
            @RequestParam(defaultValue = "false") boolean inStock,
            @RequestParam(required = false) String sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "24") int pageSize) {
        String query = q == null ? null : q.substring(0, Math.min(q.length(), 80));
        return catalog.search(new ProductFilter(department, category, query, size, color, minPrice, maxPrice, sale,
                inStock, Sort.parse(sort), page, pageSize));
    }

    @GetMapping("/facets")
    Facets facets(@RequestParam(required = false) String department) {
        return catalog.facets(department);
    }

    @GetMapping("/variants")
    List<VariantLine> variants(@RequestParam List<Long> ids) {
        return catalog.variants(ids);
    }

    @GetMapping("/products/{slug}")
    ProductDetail product(@PathVariable String slug) {
        return catalog.product(slug);
    }
}
