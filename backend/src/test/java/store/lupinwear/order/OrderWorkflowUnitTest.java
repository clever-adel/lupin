package store.lupinwear.order;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The staff workflow table itself: which status may follow which. No Spring and no database. */
class OrderWorkflowUnitTest {

    private static final List<String> ALL = List.of("PENDING", "AWAITING_PAYMENT", "PAID", "CONFIRMED", "PROCESSING",
            "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED");

    private static Set<String> next(String status) {
        return OrderAdminService.TRANSITIONS.getOrDefault(status, Set.of());
    }

    @Test
    void finishedOrdersCannotMoveAnywhere() {
        assertThat(next("DELIVERED")).isEmpty();
        assertThat(next("CANCELLED")).isEmpty();
        assertThat(next("REFUNDED")).isEmpty();
    }

    @Test
    void anOrderCanBeCancelledOnlyBeforeItShips() {
        for (String status : List.of("PENDING", "AWAITING_PAYMENT", "PAID", "CONFIRMED", "PROCESSING")) {
            assertThat(next(status)).as(status).contains("CANCELLED");
        }
        assertThat(next("SHIPPED")).containsExactly("DELIVERED");
    }

    @Test
    void staffCanNeverMarkAnOrderPaidOrSkipToShipped() {
        // PAID is set only by the payments module (signed webhook or a confirmed transfer).
        for (String status : ALL) {
            assertThat(next(status)).as(status).doesNotContain("PAID", "AWAITING_PAYMENT", "PENDING", "REFUNDED");
        }
        assertThat(next("PENDING")).doesNotContain("SHIPPED", "PROCESSING", "DELIVERED");
        assertThat(next("AWAITING_PAYMENT")).containsExactly("CANCELLED");
        assertThat(next("CONFIRMED")).doesNotContain("SHIPPED", "DELIVERED");
    }

    @Test
    void bothCashAndPaidOrdersCanReachDelivered() {
        assertThat(reachable("PENDING")).contains("CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED");
        assertThat(reachable("PAID")).contains("PROCESSING", "SHIPPED", "DELIVERED");
        assertThat(reachable("AWAITING_PAYMENT")).containsExactly("CANCELLED");
    }

    @Test
    void theTableOnlyNamesRealStatuses() {
        assertThat(ALL).containsAll(OrderAdminService.TRANSITIONS.keySet());
        OrderAdminService.TRANSITIONS.values().forEach(targets -> assertThat(ALL).containsAll(targets));
    }

    private static Set<String> reachable(String from) {
        Set<String> seen = new HashSet<>();
        Deque<String> queue = new ArrayDeque<>(next(from));
        while (!queue.isEmpty()) {
            String status = queue.pop();
            if (seen.add(status)) {
                queue.addAll(next(status));
            }
        }
        return seen;
    }
}
