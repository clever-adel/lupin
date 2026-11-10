package store.lupinwear.auth;

import jakarta.servlet.http.Cookie;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.support.IntegrationTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AuthFlowIT extends IntegrationTest {

    @Test
    void registerSetsHttpOnlyCookiesAndSignsIn() throws Exception {
        String email = uniqueEmail();
        MvcResult result = register(email);

        Cookie access = cookie(result, AuthCookies.ACCESS);
        Cookie refresh = cookie(result, AuthCookies.REFRESH);
        assertThat(access.isHttpOnly()).isTrue();
        assertThat(refresh.isHttpOnly()).isTrue();
        // The page-readable "signed in" marker carries no secret.
        Cookie hint = cookie(result, AuthCookies.HINT);
        assertThat(hint.isHttpOnly()).isFalse();
        assertThat(hint.getValue()).isEqualTo("1");
        assertThat(refresh.getPath()).isEqualTo("/api/v1/auth");
        assertThat(result.getResponse().getContentAsString()).doesNotContain("password", access.getValue());

        mvc.perform(get("/api/v1/auth/me").cookie(access))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email))
                .andExpect(jsonPath("$.roles[0]").value("CUSTOMER"));
    }

    @Test
    void meRequiresAuthentication() throws Exception {
        mvc.perform(get("/api/v1/auth/me")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        mvc.perform(get("/api/v1/auth/me").cookie(new Cookie(AuthCookies.ACCESS, "not-a-token")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void stateChangingRequestsNeedTheCsrfToken() throws Exception {
        String payload = json.writeValueAsString(new LoginBody(uniqueEmail(), PASSWORD_OK));
        mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON).content(payload))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON).content(payload)
                        .header("X-XSRF-TOKEN", "made-up"))
                .andExpect(status().isForbidden());
        // The full cookie + header round trip over real HTTP is covered by HttpSecurityIT.
    }

    @Test
    void weakOrInvalidRegistrationsAreRejected() throws Exception {
        mvc.perform(jsonPost("/api/v1/auth/register", new RegisterBody("A", "not-an-email", "123", "short", "en")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fields.email").exists())
                .andExpect(jsonPath("$.fields.password").exists())
                .andExpect(jsonPath("$.fields.phone").exists());

        String email = uniqueEmail();
        register(email);
        mvc.perform(jsonPost("/api/v1/auth/register", new RegisterBody("Dup", email.toUpperCase(), null, PASSWORD_OK, "en")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EMAIL_TAKEN"));
    }

    @Test
    void wrongPasswordAndUnknownEmailLookIdentical() throws Exception {
        String email = uniqueEmail();
        register(email);
        MvcResult wrong = login(email, "wrong-password-1");
        MvcResult unknown = login(uniqueEmail(), "wrong-password-1");
        assertThat(wrong.getResponse().getStatus()).isEqualTo(401);
        assertThat(unknown.getResponse().getStatus()).isEqualTo(401);
        assertThat(wrong.getResponse().getContentAsString()).isEqualTo(unknown.getResponse().getContentAsString());
    }

    @Test
    void accountLocksAfterRepeatedFailuresAndUnlocksLater() throws Exception {
        String email = uniqueEmail();
        register(email);
        for (int i = 0; i < 5; i++) {
            assertThat(login(email, "wrong-password-" + i).getResponse().getStatus()).isEqualTo(401);
        }
        // Correct password is refused while locked.
        assertThat(login(email, PASSWORD_OK).getResponse().getStatus()).isEqualTo(401);

        clock.advance(Duration.ofMinutes(16));
        rateLimiter.reset();
        assertThat(login(email, PASSWORD_OK).getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    void loginIsRateLimitedPerEmail() throws Exception {
        String email = uniqueEmail();
        for (int i = 0; i < 10; i++) {
            login(email, "wrong-password-" + i);
        }
        assertThat(login(email, "wrong-password-x").getResponse().getStatus()).isEqualTo(429);
    }

    @Test
    void refreshRotatesAndReuseRevokesTheWholeSession() throws Exception {
        MvcResult registered = register(uniqueEmail());
        Cookie first = cookie(registered, AuthCookies.REFRESH);

        MvcResult rotated = mvc.perform(post("/api/v1/auth/refresh").with(csrf()).cookie(first))
                .andExpect(status().isOk()).andReturn();
        Cookie second = cookie(rotated, AuthCookies.REFRESH);
        assertThat(second.getValue()).isNotEqualTo(first.getValue());

        // The old token comes back later: treated as stolen.
        clock.advance(Duration.ofSeconds(30));
        mvc.perform(post("/api/v1/auth/refresh").with(csrf()).cookie(first))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("SESSION_EXPIRED"));
        // …and the legitimate successor is dead too.
        mvc.perform(post("/api/v1/auth/refresh").with(csrf()).cookie(second)).andExpect(status().isUnauthorized());
    }

    @Test
    void accessTokenExpiresAndRefreshTokenExpires() throws Exception {
        MvcResult registered = register(uniqueEmail());
        Cookie access = cookie(registered, AuthCookies.ACCESS);
        Cookie refresh = cookie(registered, AuthCookies.REFRESH);

        clock.advance(Duration.ofMinutes(16));
        mvc.perform(get("/api/v1/auth/me").cookie(access)).andExpect(status().isUnauthorized());

        clock.advance(Duration.ofDays(31));
        mvc.perform(post("/api/v1/auth/refresh").with(csrf()).cookie(refresh)).andExpect(status().isUnauthorized());
    }

    @Test
    void logoutRevokesTheRefreshToken() throws Exception {
        MvcResult registered = register(uniqueEmail());
        Cookie refresh = cookie(registered, AuthCookies.REFRESH);

        MvcResult out = mvc.perform(post("/api/v1/auth/logout").with(csrf()).cookie(refresh))
                .andExpect(status().isNoContent()).andReturn();
        assertThat(cookie(out, AuthCookies.ACCESS).getMaxAge()).isZero();
        assertThat(cookie(out, AuthCookies.HINT).getMaxAge()).isZero();
        mvc.perform(post("/api/v1/auth/refresh").with(csrf()).cookie(refresh)).andExpect(status().isUnauthorized());
    }

    @Test
    void adminAreaIsClosedToAnonymousAndCustomers() throws Exception {
        mvc.perform(get("/api/v1/admin/inventory/1")).andExpect(status().isUnauthorized());

        Cookie customer = cookie(register(uniqueEmail()), AuthCookies.ACCESS);
        mvc.perform(get("/api/v1/admin/inventory/1").cookie(customer)).andExpect(status().isForbidden());
        mvc.perform(jsonPost("/api/v1/admin/categories", new Object() {
            public final String departmentSlug = "men";
            public final String nameEn = "Hack";
            public final String nameAr = "هاك";
        }).cookie(customer)).andExpect(status().isForbidden());
    }
}
