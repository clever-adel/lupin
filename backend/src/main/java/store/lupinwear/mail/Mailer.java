package store.lupinwear.mail;

/** Sends one email. Implementations must not throw: a failed send is logged, never shown to the visitor. */
public interface Mailer {

    record Message(String to, String subject, String text, String html) {
    }

    void send(Message message);
}
