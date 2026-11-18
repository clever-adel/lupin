package store.lupinwear.notify;

import java.util.List;

/** Sends one WhatsApp template message. Implementations must not throw: failures are logged. */
public interface WhatsAppGateway {

    boolean configured();

    /** {@code to}: international number without "+", e.g. 201012345678. */
    void sendTemplate(String to, List<String> bodyValues);
}
