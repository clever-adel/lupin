package store.lupinwear.security;

import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;
import store.lupinwear.support.IntegrationTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** With the edge key switched on, the API answers only requests that carry it (i.e. came through the Worker). */
@TestPropertySource(properties = "lupin.security.edge-secret=test-edge-secret-0123456789-abcdefghij")
class EdgeKeyIT extends IntegrationTest {

    static final String KEY = "test-edge-secret-0123456789-abcdefghij";

    @Test
    void requestsWithoutTheRightKeyAreRefusedBeforeAnythingElseRuns() throws Exception {
        mvc.perform(get("/api/v1/catalog/departments"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
        mvc.perform(get("/api/v1/catalog/departments").header(EdgeKeyFilter.HEADER, "wrong"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/catalog/departments").header(EdgeKeyFilter.HEADER, KEY + "x"))
                .andExpect(status().isForbidden());
        // Also the endpoints that need no sign-in: auth, the payment webhook, API docs.
        mvc.perform(get("/api/v1/auth/csrf")).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/payments/webhooks/paymob").param("hmac", "00").contentType("application/json")
                .content("{}")).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/openapi")).andExpect(status().isForbidden());
    }

    @Test
    void theWorkersKeyOpensTheApiAndHealthProbesNeedNone() throws Exception {
        mvc.perform(get("/api/v1/catalog/departments").header(EdgeKeyFilter.HEADER, KEY)).andExpect(status().isOk());
        // The key is not a login: private endpoints still need a session.
        mvc.perform(get("/api/v1/auth/me").header(EdgeKeyFilter.HEADER, KEY)).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }
}
