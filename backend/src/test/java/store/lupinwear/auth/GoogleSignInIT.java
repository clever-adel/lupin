package store.lupinwear.auth;

import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.util.UriComponentsBuilder;
import store.lupinwear.auth.domain.Role;
import store.lupinwear.auth.google.GoogleGateway.Profile;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.support.IntegrationTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class GoogleSignInIT extends IntegrationTest {

    @Autowired
    FakeGoogle google;

    /** Runs the whole round trip: start, "Google", callback. Returns the callback's response. */
    private MvcResult signIn(Profile profile, String query) throws Exception {
        MvcResult start = mvc.perform(get("/api/v1/auth/google/start" + query)).andExpect(status().isFound()).andReturn();
        String location = start.getResponse().getHeader("Location");
        assertThat(location).startsWith("https://accounts.google.com/o/oauth2/v2/auth?")
                .contains("code_challenge_method=S256").contains("redirect_uri=");
        String state = UriComponentsBuilder.fromUri(URI.create(location)).build().getQueryParams().getFirst("state");
        Cookie pending = cookie(start, "lw_g");
        String code = "code-" + UUID.randomUUID();
        google.profiles.put(code, profile);
        return mvc.perform(get("/api/v1/auth/google/callback").param("state", state).param("code", code).cookie(pending))
                .andExpect(status().isFound()).andReturn();
    }

    private static Profile profile(String email, boolean verified) {
        return new Profile("g-" + UUID.randomUUID(), email, verified, "Nour Hassan");
    }

    @Test
    void newGoogleAccountCreatesACustomerAndSignsIn() throws Exception {
        String email = uniqueEmail();
        MvcResult done = signIn(profile(email, true), "?lang=ar&next=/ar/checkout");
        assertThat(done.getResponse().getHeader("Location")).isEqualTo("/ar/checkout");
        mvc.perform(get("/api/v1/auth/me").cookie(cookie(done, AuthCookies.ACCESS)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email))
                .andExpect(jsonPath("$.fullName").value("Nour Hassan"))
                .andExpect(jsonPath("$.emailVerified").value(true))
                .andExpect(jsonPath("$.preferredLang").value("ar"))
                .andExpect(jsonPath("$.roles[0]").value("CUSTOMER"));
    }

    @Test
    void existingCustomerIsMatchedByEmailThenByGoogleId() throws Exception {
        String email = uniqueEmail();
        register(email);
        Profile first = profile(email, true);
        MvcResult done = signIn(first, "");
        assertThat(done.getResponse().getHeader("Location")).isEqualTo("/account");
        String id = body(mvc.perform(get("/api/v1/auth/me").cookie(cookie(done, AuthCookies.ACCESS))).andReturn()).path("id").asText();

        // Later the Google account's email changes: the permanent Google ID still finds the same person.
        MvcResult again = signIn(new Profile(first.subject(), uniqueEmail(), true, "Nour"), "");
        assertThat(body(mvc.perform(get("/api/v1/auth/me").cookie(cookie(again, AuthCookies.ACCESS))).andReturn())
                .path("id").asText()).isEqualTo(id);
        // The password still works too.
        assertThat(login(email, PASSWORD_OK).getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    void staffAndUnverifiedEmailsAreRefused() throws Exception {
        String staff = uniqueEmail();
        authService.createStaff(staff, "staff-" + PASSWORD_OK, "Staff", Role.OWNER);
        assertThat(signIn(profile(staff, true), "").getResponse().getHeader("Location")).isEqualTo("/sign-in?google=staff");
        assertThat(signIn(profile(uniqueEmail(), false), "?lang=ar").getResponse().getHeader("Location"))
                .isEqualTo("/ar/sign-in?google=unverified");
    }

    @Test
    void wrongStateMissingCookieAndOutsideAddressesAreRejected() throws Exception {
        MvcResult start = mvc.perform(get("/api/v1/auth/google/start").param("next", "//evil.example/x")).andReturn();
        Cookie pending = cookie(start, "lw_g");
        String code = "code-" + UUID.randomUUID();
        google.profiles.put(code, profile(uniqueEmail(), true));
        MvcResult wrongState = mvc.perform(get("/api/v1/auth/google/callback").param("state", "forged").param("code", code)
                .cookie(pending)).andReturn();
        assertThat(wrongState.getResponse().getHeader("Location")).isEqualTo("/sign-in?google=failed");
        assertThat(wrongState.getResponse().getHeader("Set-Cookie")).doesNotContain(AuthCookies.ACCESS + "=ey");

        MvcResult noCookie = mvc.perform(get("/api/v1/auth/google/callback").param("state", "x").param("code", "y")).andReturn();
        assertThat(noCookie.getResponse().getHeader("Location")).isEqualTo("/sign-in?google=failed");

        MvcResult cancelled = mvc.perform(get("/api/v1/auth/google/callback").param("error", "access_denied")
                .cookie(pending)).andReturn();
        assertThat(cancelled.getResponse().getHeader("Location")).isEqualTo("/sign-in?google=cancelled");

        // An outside "next" is ignored: the visitor lands on their account page.
        MvcResult done = signIn(profile(uniqueEmail(), true), "?next=https://evil.example");
        assertThat(done.getResponse().getHeader("Location")).isEqualTo("/account");
    }

    @Test
    void providersSaysGoogleIsOn() throws Exception {
        mvc.perform(get("/api/v1/auth/providers")).andExpect(status().isOk()).andExpect(jsonPath("$.google").value(true));
    }
}
