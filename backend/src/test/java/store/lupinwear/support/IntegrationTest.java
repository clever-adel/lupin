package store.lupinwear.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import jakarta.servlet.http.Cookie;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;
import store.lupinwear.auth.application.AuthService;
import store.lupinwear.auth.domain.Role;
import store.lupinwear.security.AuthCookies;
import store.lupinwear.security.RateLimiter;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Full application against a real PostgreSQL with the real Flyway migrations.
 * Testcontainers when Docker is running (CI); otherwise an embedded PostgreSQL binary (DECISIONS.md D-07).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(IntegrationTest.ClockConfig.class)
public abstract class IntegrationTest {

    private static final String URL;
    private static final String USERNAME;
    private static final String PASSWORD;

    static {
        if (dockerAvailable()) {
            @SuppressWarnings("resource")
            PostgreSQLContainer<?> container = new PostgreSQLContainer<>("postgres:17-alpine");
            container.start();
            URL = container.getJdbcUrl();
            USERNAME = container.getUsername();
            PASSWORD = container.getPassword();
        } else {
            try {
                EmbeddedPostgres pg = EmbeddedPostgres.builder().start();
                URL = pg.getJdbcUrl("postgres", "postgres");
                USERNAME = "postgres";
                PASSWORD = "";
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
    }

    private static boolean dockerAvailable() {
        try {
            return DockerClientFactory.instance().isDockerAvailable();
        } catch (Throwable t) {
            return false;
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> URL);
        registry.add("spring.datasource.username", () -> USERNAME);
        registry.add("spring.datasource.password", () -> PASSWORD);
    }

    /** A clock tests can move forward, so expiry and lockout are tested without sleeping. */
    public static class MutableClock extends Clock {
        private Duration offset = Duration.ZERO;

        public void advance(Duration d) {
            offset = offset.plus(d);
        }

        public void reset() {
            offset = Duration.ZERO;
        }

        @Override
        public Instant instant() {
            return Instant.now().plus(offset);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }
    }

    @TestConfiguration
    static class ClockConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }

        @Bean
        @Primary
        FakePaymob fakePaymob() {
            return new FakePaymob();
        }

        @Bean
        @Primary
        FakeBosta fakeBosta() {
            return new FakeBosta();
        }
    }

    /** Stands in for Bosta's API: two districts per city, and remembers the last delivery it was asked for. */
    public static class FakeBosta implements store.lupinwear.shipping.BostaGateway {
        private final java.util.concurrent.atomic.AtomicLong next = new java.util.concurrent.atomic.AtomicLong(7_000_000);
        public volatile NewDelivery lastDelivery;
        public volatile RuntimeException failNext;
        public final java.util.concurrent.atomic.AtomicInteger created = new java.util.concurrent.atomic.AtomicInteger();

        @Override
        public java.util.List<District> districts(String bostaCityId) {
            return java.util.List.of(new District("d-nasr-" + bostaCityId, "Nasr City", "مدينة نصر", true),
                    new District("d-maadi-" + bostaCityId, "Maadi", "المعادي", true),
                    new District("d-closed-" + bostaCityId, "Closed Area", "", false));
        }

        @Override
        public Created createDelivery(NewDelivery delivery) {
            RuntimeException fail = failNext;
            if (fail != null) {
                failNext = null;
                throw fail;
            }
            lastDelivery = delivery;
            created.incrementAndGet();
            long n = next.incrementAndGet();
            return new Created("bosta-id-" + n, String.valueOf(n));
        }
    }

    /** Stands in for Paymob's API: no network in tests. Remembers what it was asked. */
    public static class FakePaymob implements store.lupinwear.payment.PaymobGateway {
        private final java.util.concurrent.atomic.AtomicLong nextOrderId = new java.util.concurrent.atomic.AtomicLong(900_000);
        public volatile IntentionRequest lastRequest;

        @Override
        public Intention createIntention(IntentionRequest request) {
            lastRequest = request;
            return new Intention("cs_test_" + UUID.randomUUID(), String.valueOf(nextOrderId.incrementAndGet()));
        }
    }

    protected static final String PASSWORD_OK = "correct-horse-battery";

    @Autowired
    protected MockMvc mvc;
    @Autowired
    protected ObjectMapper json;
    @Autowired
    protected MutableClock clock;
    @Autowired
    protected RateLimiter rateLimiter;
    @Autowired
    protected AuthService authService;

    @BeforeEach
    void resetShared() {
        clock.reset();
        rateLimiter.reset();
    }

    protected static String uniqueEmail() {
        return "u" + UUID.randomUUID().toString().replace("-", "").substring(0, 16) + "@example.test";
    }

    protected MockHttpServletRequestBuilder jsonPost(String url, Object body) throws Exception {
        return post(url).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
    }

    protected MvcResult register(String email) throws Exception {
        return mvc.perform(jsonPost("/api/v1/auth/register",
                        new RegisterBody("Test Customer", email, null, PASSWORD_OK, "en")))
                .andExpect(status().isCreated()).andReturn();
    }

    protected MvcResult login(String email, String password) throws Exception {
        return mvc.perform(jsonPost("/api/v1/auth/login", new LoginBody(email, password))).andReturn();
    }

    /** Signs in a fresh staff member and returns their access cookie. */
    protected Cookie staffCookie(String role) throws Exception {
        String email = uniqueEmail();
        authService.createStaff(email, "staff-" + PASSWORD_OK, "Test Staff", role);
        MvcResult result = login(email, "staff-" + PASSWORD_OK);
        return cookie(result, AuthCookies.ACCESS);
    }

    protected Cookie ownerCookie() throws Exception {
        return staffCookie(Role.OWNER);
    }

    protected static Cookie cookie(MvcResult result, String name) {
        return Arrays.stream(result.getResponse().getCookies())
                .filter(c -> c.getName().equals(name)).reduce((a, b) -> b)
                .orElseThrow(() -> new AssertionError("No cookie " + name));
    }

    protected JsonNode body(MvcResult result) throws Exception {
        return json.readTree(result.getResponse().getContentAsString());
    }

    public record RegisterBody(String fullName, String email, String phone, String password, String lang) {
    }

    public record LoginBody(String email, String password) {
    }
}
