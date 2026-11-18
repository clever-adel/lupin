package store.lupinwear.notify;

/** Delivers one already-encrypted Web Push message. Must not throw: returns the HTTP status, or 0. */
public interface PushGateway {

    int deliver(String endpoint, String authorization, byte[] body);
}
