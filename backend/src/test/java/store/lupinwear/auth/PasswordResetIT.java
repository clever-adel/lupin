package store.lupinwear.auth;

import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MvcResult;
import store.lupinwear.auth.domain.Role;
import store.lupinwear.mail.Mailer;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.support.IntegrationTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PasswordResetIT extends IntegrationTest {

    private static final Pattern TOKEN = Pattern.compile("#token=([A-Za-z0-9_-]+)");

    @Autowired
    FakeMailer mailer;

    record Forgot(String email, String lang) {
    }

    record Reset(String token, String newPassword) {
    }

    @BeforeEach
    void clearMail() {
        mailer.sent.clear();
    }

    private Mailer.Message nextMail() throws InterruptedException {
        Mailer.Message m = mailer.sent.poll(5, TimeUnit.SECONDS);
        assertThat(m).as("an email was sent").isNotNull();
        return m;
    }

    private static String token(Mailer.Message m) {
        Matcher matcher = TOKEN.matcher(m.text());
        assertThat(matcher.find()).isTrue();
        return matcher.group(1);
    }

    @Test
    void linkResetsThePasswordOnceAndEndsOldSessions() throws Exception {
        String email = uniqueEmail();
        MvcResult reg = register(email);
        var oldRefresh = cookie(reg, AuthCookies.REFRESH);

        mvc.perform(jsonPost("/api/v1/auth/forgot-password", new Forgot(email.toUpperCase(), "ar")))
                .andExpect(status().isAccepted());
        Mailer.Message mail = nextMail();
        assertThat(mail.to()).isEqualTo(email);
        assertThat(mail.text()).contains("/ar/reset-password#token=");
        String token = token(mail);

        mvc.perform(jsonPost("/api/v1/auth/reset-password", new Reset(token, "brand-new-password-1")))
                .andExpect(status().isNoContent());
        assertThat(login(email, PASSWORD_OK).getResponse().getStatus()).isEqualTo(401);
        assertThat(login(email, "brand-new-password-1").getResponse().getStatus()).isEqualTo(200);
        // The session from before the reset no longer refreshes.
        mvc.perform(jsonPost("/api/v1/auth/refresh", null).cookie(oldRefresh)).andExpect(status().isUnauthorized());

        // Used once: the same link is refused the second time.
        mvc.perform(jsonPost("/api/v1/auth/reset-password", new Reset(token, "another-password-22")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("RESET_LINK_INVALID"));
    }

    @Test
    void unknownEmailGetsTheSameAnswerAndNoMail() throws Exception {
        mvc.perform(jsonPost("/api/v1/auth/forgot-password", new Forgot(uniqueEmail(), "en")))
                .andExpect(status().isAccepted());
        assertThat(mailer.sent.poll(500, TimeUnit.MILLISECONDS)).isNull();
    }

    @Test
    void linkExpiresAfterAnHourAndOnlyTheNewestWorks() throws Exception {
        String email = uniqueEmail();
        register(email);
        mvc.perform(jsonPost("/api/v1/auth/forgot-password", new Forgot(email, "en"))).andExpect(status().isAccepted());
        String first = token(nextMail());
        mvc.perform(jsonPost("/api/v1/auth/forgot-password", new Forgot(email, "en"))).andExpect(status().isAccepted());
        String second = token(nextMail());

        mvc.perform(jsonPost("/api/v1/auth/reset-password", new Reset(first, "brand-new-password-1")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("RESET_LINK_INVALID"));
        clock.advance(Duration.ofMinutes(61));
        mvc.perform(jsonPost("/api/v1/auth/reset-password", new Reset(second, "brand-new-password-1")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("RESET_LINK_INVALID"));
        mvc.perform(jsonPost("/api/v1/auth/reset-password", new Reset("made-up-token", "brand-new-password-1")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void staffNeedTwelveCharactersAndKeepTheLinkUntilThen() throws Exception {
        String email = uniqueEmail();
        authService.createStaff(email, "staff-" + PASSWORD_OK, "Test Staff", Role.ADMIN);
        mvc.perform(jsonPost("/api/v1/auth/forgot-password", new Forgot(email, "en"))).andExpect(status().isAccepted());
        String token = token(nextMail());
        mvc.perform(jsonPost("/api/v1/auth/reset-password", new Reset(token, "short-pw-11")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("WEAK_PASSWORD"));
        mvc.perform(jsonPost("/api/v1/auth/reset-password", new Reset(token, "a-long-staff-password")))
                .andExpect(status().isNoContent());
        assertThat(login(email, "a-long-staff-password").getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    void requestsAreRateLimitedPerEmail() throws Exception {
        String email = uniqueEmail();
        register(email);
        for (int i = 0; i < 3; i++) {
            mvc.perform(jsonPost("/api/v1/auth/forgot-password", new Forgot(email, "en"))).andExpect(status().isAccepted());
        }
        mvc.perform(jsonPost("/api/v1/auth/forgot-password", new Forgot(email, "en")))
                .andExpect(status().isTooManyRequests());
    }
}
