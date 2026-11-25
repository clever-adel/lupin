package store.lupinwear.auth.mfa;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class TotpUnitTest {

    /** RFC 6238 appendix B, SHA-1 key; the apps show the last six of its eight digits. */
    private static final byte[] RFC_KEY = "12345678901234567890".getBytes(StandardCharsets.US_ASCII);

    @Test
    void matchesTheRfcTestVectors() {
        assertThat(Totp.code(RFC_KEY, Totp.step(Instant.ofEpochSecond(59)))).isEqualTo("287082");
        assertThat(Totp.code(RFC_KEY, Totp.step(Instant.ofEpochSecond(1111111109)))).isEqualTo("081804");
        assertThat(Totp.code(RFC_KEY, Totp.step(Instant.ofEpochSecond(1234567890)))).isEqualTo("005924");
        assertThat(Totp.code(RFC_KEY, Totp.step(Instant.ofEpochSecond(2000000000)))).isEqualTo("279037");
    }

    @Test
    void acceptsOneStepEitherSideAndNothingFurther() {
        Instant now = Instant.ofEpochSecond(1_700_000_000);
        long step = Totp.step(now);
        assertThat(Totp.matchingStep(RFC_KEY, Totp.code(RFC_KEY, step - 1), now)).hasValue(step - 1);
        assertThat(Totp.matchingStep(RFC_KEY, Totp.code(RFC_KEY, step + 1), now)).hasValue(step + 1);
        assertThat(Totp.matchingStep(RFC_KEY, Totp.code(RFC_KEY, step - 3), now)).isEmpty();
        assertThat(Totp.matchingStep(RFC_KEY, "12345", now)).isEmpty();
        assertThat(Totp.matchingStep(RFC_KEY, "abcdef", now)).isEmpty();
    }

    @Test
    void base32IsTheRfc4648Alphabet() {
        assertThat(Totp.base32("foobar".getBytes(StandardCharsets.US_ASCII))).isEqualTo("MZXW6YTBOI");
        assertThat(Totp.base32(RFC_KEY)).isEqualTo("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    }
}
