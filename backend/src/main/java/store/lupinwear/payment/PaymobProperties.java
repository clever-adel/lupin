package store.lupinwear.payment;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Paymob credentials and addresses. Values come from the environment / secret manager only; they are
 * never sent to the browser except the public key, which Paymob designs to be public.
 */
@ConfigurationProperties("lupin.paymob")
public record PaymobProperties(String secretKey, String publicKey, String hmacSecret, Integer integrationCard,
        Integer integrationWallet, Integer integrationFawry, String intentionUrl, String checkoutUrl) {

    public boolean configured() {
        return hasText(secretKey) && hasText(publicKey) && hasText(hmacSecret);
    }

    /** The Paymob integration id for one of our method names, or null when that method is not set up. */
    public Integer integrationFor(String method) {
        if (!configured()) {
            return null;
        }
        return switch (method) {
            case "CARD" -> integrationCard;
            case "WALLET" -> integrationWallet;
            case "FAWRY" -> integrationFawry;
            default -> null;
        };
    }

    private static boolean hasText(String s) {
        return s != null && !s.isBlank();
    }

    /** Never print keys, even by accident in a log line. */
    @Override
    public String toString() {
        return "PaymobProperties[configured=" + configured() + "]";
    }
}
