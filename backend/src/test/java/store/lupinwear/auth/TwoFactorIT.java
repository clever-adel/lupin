package store.lupinwear.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.Cookie;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MvcResult;
import store.lupinwear.auth.domain.Role;
import store.lupinwear.auth.mfa.Totp;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.support.IntegrationTest;

class TwoFactorIT extends IntegrationTest {

    private static final String PASSWORD = "staff-" + PASSWORD_OK;

    @Autowired
    JdbcClient jdbc;

    private String newStaff(String role) {
        String email = uniqueEmail();
        authService.createStaff(email, PASSWORD, "Two Step", role);
        return email;
    }

    private void nextStep() {
        clock.advance(Duration.ofSeconds(Totp.PERIOD_SECONDS));
    }

    @Test
    void staffMustPairAnAppBeforeTheDashboardWorks() throws Exception {
        String email = newStaff(Role.ADMIN);
        MvcResult signedIn = login(email, PASSWORD);
        Cookie access = cookie(signedIn, AuthCookies.ACCESS);
        assertThat(body(signedIn).get("twoFactor").asText()).isEqualTo("SETUP");

        mvc.perform(get("/api/v1/admin/summary").cookie(access))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("MFA_REQUIRED"));

        // A wrong first code does not switch it on.
        MvcResult setup = mvc.perform(post("/api/v1/auth/mfa/setup").with(csrf()).cookie(access))
                .andExpect(status().isOk()).andReturn();
        assertThat(body(setup).get("uri").asText()).startsWith("otpauth://totp/LUPIN%3A").contains("issuer=LUPIN");
        byte[] secret = base32(body(setup).get("secret").asText());
        mvc.perform(jsonPost("/api/v1/auth/mfa/enable", new CodeBody("000000")).cookie(access))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("MFA_CODE_WRONG"));

        MvcResult enabled = mvc.perform(jsonPost("/api/v1/auth/mfa/enable", new CodeBody(appCode(secret))).cookie(access))
                .andExpect(status().isOk()).andReturn();
        assertThat(body(enabled).get("recoveryCodes")).hasSize(10);
        // Only hashes are kept.
        String code = body(enabled).get("recoveryCodes").get(0).asText();
        assertThat(jdbc.sql("select count(*) from staff_recovery_codes where code_hash like :c")
                .param("c", "%" + code.replace("-", "") + "%").query(Long.class).single()).isZero();
        // And the key is stored encrypted, not as the text the app was given.
        String stored = jdbc.sql("select totp_secret from users where email = :e").param("e", email)
                .query(String.class).single();
        assertThat(stored).startsWith("v1.").doesNotContain(Totp.base32(secret));

        mvc.perform(get("/api/v1/admin/summary").cookie(access)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/auth/me").cookie(access)).andExpect(jsonPath("$.twoFactor").value("ON"));
        // Once on, it cannot be re-paired by whoever holds a session.
        mvc.perform(post("/api/v1/auth/mfa/setup").with(csrf()).cookie(access))
                .andExpect(status().isConflict());
    }

    @Test
    void afterPairingThePasswordAloneOpensNothing() throws Exception {
        String email = newStaff(Role.OWNER);
        byte[] secret = enableTwoFactor(cookie(login(email, PASSWORD), AuthCookies.ACCESS));
        nextStep();

        MvcResult first = login(email, PASSWORD);
        assertThat(first.getResponse().getStatus()).isEqualTo(200);
        assertThat(body(first).get("mfaRequired").asBoolean()).isTrue();
        assertThat(body(first).has("email")).isFalse();
        assertThat(Arrays.stream(first.getResponse().getCookies()).map(Cookie::getName))
                .doesNotContain(AuthCookies.ACCESS, AuthCookies.REFRESH);
        Cookie challenge = cookie(first, AuthCookies.MFA);
        assertThat(challenge.isHttpOnly()).isTrue();

        // The challenge is not a session, even when planted as one.
        mvc.perform(get("/api/v1/admin/summary").cookie(new Cookie(AuthCookies.ACCESS, challenge.getValue())))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/auth/me").cookie(new Cookie(AuthCookies.ACCESS, challenge.getValue())))
                .andExpect(status().isUnauthorized());

        mvc.perform(jsonPost("/api/v1/auth/mfa/verify", new CodeBody("123456")).cookie(challenge))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("MFA_CODE_WRONG"));
        mvc.perform(jsonPost("/api/v1/auth/mfa/verify", new CodeBody(appCode(secret))))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("MFA_CHALLENGE_EXPIRED"));

        String code = appCode(secret);
        MvcResult done = mvc.perform(jsonPost("/api/v1/auth/mfa/verify", new CodeBody(code)).cookie(challenge))
                .andExpect(status().isOk()).andExpect(jsonPath("$.twoFactor").value("ON")).andReturn();
        Cookie access = cookie(done, AuthCookies.ACCESS);
        mvc.perform(get("/api/v1/admin/summary").cookie(access)).andExpect(status().isOk());

        // The same code, seen over a shoulder, does not work a second time.
        Cookie again = cookie(login(email, PASSWORD), AuthCookies.MFA);
        mvc.perform(jsonPost("/api/v1/auth/mfa/verify", new CodeBody(code)).cookie(again))
                .andExpect(status().isUnauthorized());

        // A refreshed token belongs to the same verified sign-in.
        MvcResult refreshed = mvc.perform(jsonPost("/api/v1/auth/refresh", java.util.Map.of())
                .cookie(cookie(done, AuthCookies.REFRESH))).andExpect(status().isOk()).andReturn();
        mvc.perform(get("/api/v1/admin/summary").cookie(cookie(refreshed, AuthCookies.ACCESS)))
                .andExpect(status().isOk());
    }

    @Test
    void theChallengeExpiresAfterFiveMinutes() throws Exception {
        String email = newStaff(Role.ADMIN);
        byte[] secret = enableTwoFactor(cookie(login(email, PASSWORD), AuthCookies.ACCESS));
        Cookie challenge = cookie(login(email, PASSWORD), AuthCookies.MFA);
        clock.advance(Duration.ofMinutes(6));
        mvc.perform(jsonPost("/api/v1/auth/mfa/verify", new CodeBody(appCode(secret))).cookie(challenge))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("MFA_CHALLENGE_EXPIRED"));
    }

    @Test
    void wrongCodesLockTheAccount() throws Exception {
        String email = newStaff(Role.ADMIN);
        byte[] secret = enableTwoFactor(cookie(login(email, PASSWORD), AuthCookies.ACCESS));
        Cookie challenge = cookie(login(email, PASSWORD), AuthCookies.MFA);
        for (int i = 0; i < 6; i++) {
            mvc.perform(jsonPost("/api/v1/auth/mfa/verify", new CodeBody("000000")).cookie(challenge));
        }
        nextStep();
        // The right password and the right code are both refused while locked.
        mvc.perform(jsonPost("/api/v1/auth/mfa/verify", new CodeBody(appCode(secret))).cookie(challenge))
                .andExpect(status().isTooManyRequests());
        mvc.perform(jsonPost("/api/v1/auth/login", new LoginBody(email, PASSWORD)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void recoveryCodesWorkOnceEach() throws Exception {
        String email = newStaff(Role.ADMIN);
        Cookie access = cookie(login(email, PASSWORD), AuthCookies.ACCESS);
        MvcResult setup = mvc.perform(post("/api/v1/auth/mfa/setup").with(csrf()).cookie(access)).andReturn();
        byte[] secret = base32(body(setup).get("secret").asText());
        List<String> codes = new ArrayList<>();
        body(mvc.perform(jsonPost("/api/v1/auth/mfa/enable", new CodeBody(appCode(secret))).cookie(access))
                .andReturn()).get("recoveryCodes").forEach(c -> codes.add(c.asText()));

        // Typed loosely: capitals, no dash.
        String loose = codes.get(0).replace("-", "").toUpperCase();
        mvc.perform(jsonPost("/api/v1/auth/mfa/verify", new CodeBody(loose))
                .cookie(cookie(login(email, PASSWORD), AuthCookies.MFA))).andExpect(status().isOk());
        mvc.perform(jsonPost("/api/v1/auth/mfa/verify", new CodeBody(codes.get(0)))
                .cookie(cookie(login(email, PASSWORD), AuthCookies.MFA))).andExpect(status().isUnauthorized());

        JsonNode status = body(mvc.perform(get("/api/v1/auth/mfa/status").cookie(access)).andReturn());
        assertThat(status.get("recoveryCodesLeft").asInt()).isEqualTo(9);

        // New codes need a fresh app code; the old ones stop working.
        nextStep();
        mvc.perform(jsonPost("/api/v1/auth/mfa/recovery-codes", new CodeBody(appCode(secret))).cookie(access))
                .andExpect(status().isOk()).andExpect(jsonPath("$.recoveryCodes.length()").value(10));
        mvc.perform(jsonPost("/api/v1/auth/mfa/verify", new CodeBody(codes.get(1)))
                .cookie(cookie(login(email, PASSWORD), AuthCookies.MFA))).andExpect(status().isUnauthorized());
    }

    @Test
    void pairingEndsEveryOtherSignInThatNeverPassedTheCode() throws Exception {
        String email = newStaff(Role.ADMIN);
        Cookie elsewhere = cookie(login(email, PASSWORD), AuthCookies.ACCESS);
        Cookie elsewhereRefresh = cookie(login(email, PASSWORD), AuthCookies.REFRESH);
        Cookie here = cookie(login(email, PASSWORD), AuthCookies.ACCESS);
        enableTwoFactor(here);

        mvc.perform(get("/api/v1/admin/summary").cookie(here)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/admin/summary").cookie(elsewhere)).andExpect(status().isForbidden());
        mvc.perform(jsonPost("/api/v1/auth/refresh", java.util.Map.of()).cookie(elsewhereRefresh))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void theOwnerResetsItForSomeoneWhoLostTheirPhone() throws Exception {
        Cookie owner = ownerCookie();
        String email = newStaff(Role.ADMIN);
        Cookie access = cookie(login(email, PASSWORD), AuthCookies.ACCESS);
        enableTwoFactor(access);
        String id = jdbc.sql("select id::text from users where email = :e").param("e", email)
                .query(String.class).single();
        mvc.perform(get("/api/v1/admin/staff").cookie(owner))
                .andExpect(jsonPath("$[?(@.id=='" + id + "')].twoFactor").value(true));

        mvc.perform(post("/api/v1/admin/staff/" + id + "/two-factor/reset").with(csrf()).cookie(access))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/admin/staff/" + id + "/two-factor/reset").with(csrf()).cookie(owner))
                .andExpect(status().isNoContent());

        mvc.perform(get("/api/v1/admin/summary").cookie(access)).andExpect(status().isUnauthorized());
        // The ended sign-in, whose token has not expired yet, cannot start pairing a phone.
        mvc.perform(get("/api/v1/auth/me").cookie(access)).andExpect(jsonPath("$.twoFactor").value("SIGN_IN_AGAIN"));
        mvc.perform(post("/api/v1/auth/mfa/setup").with(csrf()).cookie(access)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/admin/staff").cookie(owner))
                .andExpect(jsonPath("$[?(@.id=='" + id + "')].twoFactor").value(false));
        // Next sign-in: straight in with the password, and asked to pair the new phone.
        MvcResult next = login(email, PASSWORD);
        assertThat(body(next).get("twoFactor").asText()).isEqualTo("SETUP");
    }

    @Test
    void customersAreNotAffected() throws Exception {
        String email = uniqueEmail();
        register(email);
        MvcResult signedIn = login(email, PASSWORD_OK);
        assertThat(body(signedIn).hasNonNull("twoFactor")).isFalse();
        Cookie access = cookie(signedIn, AuthCookies.ACCESS);
        mvc.perform(get("/api/v1/auth/me").cookie(access)).andExpect(status().isOk());
        mvc.perform(post("/api/v1/auth/mfa/setup").with(csrf()).cookie(access)).andExpect(status().isForbidden());
    }
}
