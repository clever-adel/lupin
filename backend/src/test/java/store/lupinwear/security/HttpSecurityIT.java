package store.lupinwear.security;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import store.lupinwear.support.IntegrationTest;

import static org.assertj.core.api.Assertions.assertThat;

/** Real HTTP against embedded Tomcat: what a browser actually receives. */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class HttpSecurityIT extends IntegrationTest {

    @LocalServerPort
    int port;

    private final HttpClient http = HttpClient.newHttpClient();

    @Test
    void doubleSubmitCsrfAndCookieFlagsOverRealHttp() throws Exception {
        String registration = json.writeValueAsString(
                new RegisterBody("Http Customer", uniqueEmail(), null, PASSWORD_OK, "en"));

        HttpResponse<String> blocked = http.send(post("/api/v1/auth/register", registration).build(),
                BodyHandlers.ofString());
        assertThat(blocked.statusCode()).isEqualTo(403);
        assertThat(blocked.body()).contains("FORBIDDEN").doesNotContain("Exception", "trace");

        HttpResponse<String> csrf = http.send(HttpRequest.newBuilder(uri("/api/v1/auth/csrf")).build(),
                BodyHandlers.ofString());
        JsonNode csrfBody = json.readTree(csrf.body());
        String csrfCookie = setCookie(csrf, "XSRF-TOKEN");
        assertThat(csrfCookie).contains("SameSite=Lax").doesNotContain("HttpOnly");
        assertThat(csrfBody.get("headerName").asText()).isEqualTo("X-XSRF-TOKEN");

        HttpResponse<String> created = http.send(post("/api/v1/auth/register", registration)
                .header("Cookie", csrfCookie.split(";")[0])
                .header("X-XSRF-TOKEN", csrfBody.get("token").asText()).build(), BodyHandlers.ofString());
        assertThat(created.statusCode()).isEqualTo(201);
        assertThat(setCookie(created, AuthCookies.ACCESS)).contains("HttpOnly", "SameSite=Lax", "Path=/");
        assertThat(setCookie(created, AuthCookies.REFRESH)).contains("HttpOnly", "SameSite=Lax", "Path=/api/v1/auth");
    }

    /**
     * The staff product editor saves the product and each colour's photos in parallel, all with the one
     * XSRF-TOKEN cookie. A signed-in request must not delete or replace that cookie, or the later saves
     * are refused with 403 ("You are not allowed to do this.").
     */
    @Test
    void signedInRequestsKeepTheCsrfToken() throws Exception {
        HttpResponse<String> csrf = http.send(HttpRequest.newBuilder(uri("/api/v1/auth/csrf")).build(),
                BodyHandlers.ofString());
        String xsrf = setCookie(csrf, "XSRF-TOKEN").split(";")[0];
        String token = json.readTree(csrf.body()).get("token").asText();

        HttpResponse<String> created = http.send(post("/api/v1/auth/register", json.writeValueAsString(
                        new RegisterBody("Token Keeper", uniqueEmail(), null, PASSWORD_OK, "en")))
                .header("Cookie", xsrf).header("X-XSRF-TOKEN", token).build(), BodyHandlers.ofString());
        assertThat(created.statusCode()).isEqualTo(201);
        String cookies = xsrf + "; " + setCookie(created, AuthCookies.ACCESS).split(";")[0];

        HttpResponse<String> me = http.send(HttpRequest.newBuilder(uri("/api/v1/auth/me"))
                .header("Cookie", cookies).build(), BodyHandlers.ofString());
        assertThat(me.statusCode()).isEqualTo(200);
        assertThat(me.headers().allValues("Set-Cookie")).noneMatch(c -> c.startsWith("XSRF-TOKEN="));

        HttpResponse<String> again = http.send(HttpRequest.newBuilder(uri("/api/v1/auth/csrf"))
                .header("Cookie", cookies).build(), BodyHandlers.ofString());
        assertThat(json.readTree(again.body()).get("token").asText()).isEqualTo(token);
        assertThat(again.headers().allValues("Set-Cookie")).noneMatch(c -> c.startsWith("XSRF-TOKEN="));
    }

    @Test
    void securityHeadersAndSafeErrors() throws Exception {
        HttpResponse<String> health = http.send(HttpRequest.newBuilder(uri("/actuator/health")).build(),
                BodyHandlers.ofString());
        assertThat(health.statusCode()).isEqualTo(200);
        assertThat(health.body()).contains("\"status\":\"UP\"").doesNotContain("components", "jdbc", "details");
        assertThat(health.headers().firstValue("X-Content-Type-Options")).hasValue("nosniff");
        assertThat(health.headers().firstValue("X-Frame-Options")).hasValue("DENY");
        assertThat(health.headers().firstValue("Referrer-Policy")).hasValue("strict-origin-when-cross-origin");

        // Actuator internals are not exposed.
        assertThat(http.send(HttpRequest.newBuilder(uri("/actuator/env")).build(), BodyHandlers.ofString())
                .statusCode()).isIn(401, 404);

        HttpResponse<String> missing = http.send(
                HttpRequest.newBuilder(uri("/api/v1/catalog/products/does-not-exist")).build(), BodyHandlers.ofString());
        assertThat(missing.statusCode()).isEqualTo(404);
        assertThat(missing.body()).isEqualTo("{\"code\":\"NOT_FOUND\",\"message\":\"Product not found\"}");
    }

    @Test
    void corsIsClosedToUnknownOrigins() throws Exception {
        HttpResponse<String> response = http.send(HttpRequest.newBuilder(uri("/api/v1/catalog/departments"))
                .header("Origin", "https://evil.example").build(), BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(403);
        assertThat(response.headers().firstValue("Access-Control-Allow-Origin")).isEmpty();
    }

    private HttpRequest.Builder post(String path, String body) {
        return HttpRequest.newBuilder(uri(path)).header("Content-Type", "application/json")
                .POST(BodyPublishers.ofString(body));
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    private static String setCookie(HttpResponse<?> response, String name) {
        List<String> all = response.headers().allValues("Set-Cookie");
        return all.stream().filter(c -> c.startsWith(name + "=")).reduce((a, b) -> b)
                .orElseThrow(() -> new AssertionError("No Set-Cookie for " + name + " in " + all));
    }
}
