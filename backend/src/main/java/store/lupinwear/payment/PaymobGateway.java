package store.lupinwear.payment;

/** The one outbound call to Paymob. An interface so tests never touch the network. */
public interface PaymobGateway {

    record IntentionRequest(long amountCents, int integrationId, String itemName, String specialReference,
            String firstName, String lastName, String phone, String email, String city, String street,
            String notificationUrl, String redirectionUrl, int expirationSeconds) {
    }

    record Intention(String clientSecret, String providerOrderId) {
    }

    Intention createIntention(IntentionRequest request);
}
