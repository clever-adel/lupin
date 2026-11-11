package store.lupinwear.payment;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Pure logic, no Spring and no database. */
class PaymentUnitTest {

    @Test
    void hmacSha512MatchesThePublishedTestVector() {
        // RFC 4231, test case 2.
        assertThat(PaymentService.sign("what do ya want for nothing?", "Jefe")).isEqualTo(
                "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea250554"
                        + "9758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737");
    }

    @Test
    void signatureChangesWithTheDataAndWithTheSecret() {
        String base = PaymentService.sign("106000EGPtrue", "secret-a");
        assertThat(base).hasSize(128).matches("[0-9a-f]+");
        assertThat(PaymentService.sign("106001EGPtrue", "secret-a")).isNotEqualTo(base);
        assertThat(PaymentService.sign("106000EGPtrue", "secret-b")).isNotEqualTo(base);
    }

    @Test
    void onlinePaymentsNeedAllThreeKeysAndTheMethodsOwnIntegrationId() {
        PaymobProperties none = new PaymobProperties("", "", "", 111, 222, null, "u", "c");
        assertThat(none.configured()).isFalse();
        assertThat(none.integrationFor("CARD")).isNull();

        PaymobProperties partial = new PaymobProperties("sk", "pk", " ", 111, 222, null, "u", "c");
        assertThat(partial.configured()).isFalse();

        PaymobProperties ready = new PaymobProperties("sk", "pk", "hmac", 111, 222, null, "u", "c");
        assertThat(ready.configured()).isTrue();
        assertThat(ready.integrationFor("CARD")).isEqualTo(111);
        assertThat(ready.integrationFor("WALLET")).isEqualTo(222);
        assertThat(ready.integrationFor("FAWRY")).isNull();          // no integration id configured
        assertThat(ready.integrationFor("COD")).isNull();            // not a Paymob method
        assertThat(ready.integrationFor("INSTAPAY_MANUAL")).isNull();
    }

    @Test
    void keysAreNeverPrinted() {
        PaymobProperties ready = new PaymobProperties("sk-live-secret", "pk", "hmac-secret", 1, 2, 3, "u", "c");
        assertThat(ready.toString()).doesNotContain("sk-live-secret").doesNotContain("hmac-secret");
    }
}
