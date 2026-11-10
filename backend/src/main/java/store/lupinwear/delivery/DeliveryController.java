package store.lupinwear.delivery;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.delivery.DeliveryService.GovernorateView;
import store.lupinwear.delivery.DeliveryService.OptionView;

@RestController
@RequestMapping("/api/v1/delivery")
public class DeliveryController {

    private final DeliveryService delivery;

    public DeliveryController(DeliveryService delivery) {
        this.delivery = delivery;
    }

    @GetMapping("/governorates")
    List<GovernorateView> governorates() {
        return delivery.governorates();
    }

    /** List fees before any discount; the checkout quote decides whether delivery ends up free. */
    @GetMapping("/options")
    List<OptionView> options(@RequestParam int governorateId) {
        return delivery.options(governorateId);
    }
}
