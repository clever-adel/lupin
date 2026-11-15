package store.lupinwear.look;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.look.LookDtos.LookCard;
import store.lupinwear.look.LookDtos.LookDetail;

/** Public, read-only. Lives under /catalog so it shares the catalogue's open GET rule. */
@RestController
@RequestMapping("/api/v1/catalog/looks")
public class LookController {

    private final LookQueryService looks;

    public LookController(LookQueryService looks) {
        this.looks = looks;
    }

    @GetMapping
    List<LookCard> looks(@RequestParam(required = false) String product) {
        return product == null || product.isBlank() ? looks.looks() : looks.looksWithProduct(product);
    }

    @GetMapping("/{slug}")
    LookDetail look(@PathVariable String slug) {
        return looks.look(slug);
    }
}
