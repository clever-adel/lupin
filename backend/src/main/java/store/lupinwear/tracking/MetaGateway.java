package store.lupinwear.tracking;

import java.util.Map;

/** Sends server events to Meta. Swapped for a fake in tests. */
public interface MetaGateway {

    boolean configured();

    /** POSTs one batch of events for this Pixel. Returns true when Meta accepted it. Never throws. */
    boolean send(String pixelId, Map<String, Object> payload);
}
