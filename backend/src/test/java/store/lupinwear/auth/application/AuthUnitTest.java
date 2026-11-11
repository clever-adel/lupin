package store.lupinwear.auth.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import store.lupinwear.auth.domain.User;

/** Pure logic, no Spring and no database. */
class AuthUnitTest {

    @Test
    void emailsAreComparedWithoutCaseOrSurroundingSpaces() {
        assertThat(AuthService.normalizeEmail("  Mona.Adel@Example.COM ")).isEqualTo("mona.adel@example.com");
    }

    @Test
    void refreshTokensAreStoredOnlyAsASha256Hash() {
        // Published SHA-256 of "abc".
        assertThat(AuthService.sha256("abc"))
                .isEqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assertThat(AuthService.sha256("token-1")).isNotEqualTo(AuthService.sha256("token-2")).hasSize(64);
    }

    @Test
    void lockoutEndsAtItsTimeAndASuccessfulSignInClearsIt() {
        User user = new User("a@example.test", null, "hash", "A Customer", "en");
        Instant now = Instant.parse("2026-11-11T10:00:00Z");
        assertThat(user.isLocked(now)).isFalse();

        user.lockUntil(now.plusSeconds(900));
        assertThat(user.isLocked(now)).isTrue();
        assertThat(user.isLocked(now.plusSeconds(899))).isTrue();
        assertThat(user.isLocked(now.plusSeconds(900))).isFalse();

        user.lockUntil(now.plusSeconds(900));
        user.recordSuccessfulLogin(now);
        assertThat(user.isLocked(now)).isFalse();
        assertThat(user.getFailedLoginCount()).isZero();
    }

    @Test
    void aNewPasswordAlsoClearsAnyLockout() {
        User user = new User("a@example.test", null, "old-hash", "A Customer", "en");
        Instant now = Instant.parse("2026-11-11T10:00:00Z");
        user.lockUntil(now.plusSeconds(3600));

        user.changePassword("new-hash");

        assertThat(user.getPasswordHash()).isEqualTo("new-hash");
        assertThat(user.isLocked(now)).isFalse();
        assertThat(user.canSignIn()).isTrue();
    }
}
