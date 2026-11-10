package store.lupinwear.order;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Releases stock held by online-payment orders that were never paid. Safe on several instances at
 * once: rows are taken with SKIP LOCKED. On Cloud Run the service must keep at least one instance
 * (or this must be triggered by Cloud Scheduler) for the timer to fire.
 */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "lupin.jobs.enabled", havingValue = "true")
public class UnpaidOrderJob {

    private static final Logger log = LoggerFactory.getLogger(UnpaidOrderJob.class);

    private final OrderService orders;

    public UnpaidOrderJob(OrderService orders) {
        this.orders = orders;
    }

    @Scheduled(fixedDelayString = "PT5M", initialDelayString = "PT1M")
    void run() {
        int cancelled = orders.expireUnpaid();
        if (cancelled > 0) {
            log.info("Cancelled {} unpaid orders and released their stock", cancelled);
        }
    }
}
