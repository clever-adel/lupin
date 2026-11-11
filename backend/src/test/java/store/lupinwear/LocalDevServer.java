package store.lupinwear;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import org.springframework.boot.SpringApplication;

/**
 * Runs the API on http://localhost:8080 for local development on a machine without Docker:
 * {@code ./mvnw spring-boot:test-run}. Starts an embedded PostgreSQL that keeps its data in
 * backend/.localdb, applies migrations + demo data ("local" profile) and uses a throwaway JWT key.
 * With Docker available, prefer {@code docker compose up} and the normal {@code spring-boot:run}.
 */
public class LocalDevServer {

    public static void main(String[] args) throws Exception {
        // LUPIN_LOCAL_DB lets a second, separate copy run next to the everyday one (the browser tests
        // use backend/.e2e-db on another port, so they never touch the data you are looking at).
        String dataDir = System.getenv().getOrDefault("LUPIN_LOCAL_DB", ".localdb");
        EmbeddedPostgres pg = EmbeddedPostgres.builder()
                .setDataDirectory(Path.of(dataDir).toAbsolutePath())
                .setCleanDataDirectory(false)
                // Keep the PostgreSQL program files next to the project, not in the system temp folder:
                // a temp clean-up while the server is running breaks every new database connection.
                .setOverrideWorkingDirectory(Path.of(".local-pg").toAbsolutePath().toFile())
                // Crash recovery after an unclean stop can take longer than the 10 s default.
                .setPGStartupWait(Duration.ofSeconds(90))
                .start();
        byte[] key = new byte[48];
        new SecureRandom().nextBytes(key);

        SpringApplication app = new SpringApplication(LupinApplication.class);
        app.setAdditionalProfiles("local");
        app.run(
                "--spring.datasource.url=" + pg.getJdbcUrl("postgres", "postgres"),
                "--spring.datasource.username=postgres",
                "--spring.datasource.password=",
                "--lupin.security.jwt-secret=" + Base64.getEncoder().encodeToString(key),
                "--lupin.bootstrap.owner-email=" + LOCAL_OWNER_EMAIL,
                "--lupin.bootstrap.owner-password=" + localOwnerPassword(),
                "--lupin.security.edge-secret=" + localEdgeSecret());
    }

    /**
     * If the storefront has a local Worker secret (frontend/.dev.vars, git-ignored), use the same
     * value here, so the local stack runs with the API locked to the Worker exactly as in production.
     * Without that file the lock is off.
     */
    private static String localEdgeSecret() throws java.io.IOException {
        Path vars = Path.of("..", "frontend", ".dev.vars").toAbsolutePath().normalize();
        if (!java.nio.file.Files.exists(vars)) {
            return "";
        }
        return java.nio.file.Files.readAllLines(vars).stream()
                .filter(line -> line.startsWith("EDGE_SHARED_SECRET="))
                .map(line -> line.substring("EDGE_SHARED_SECRET=".length()).trim().replaceAll("^\"|\"$", ""))
                .findFirst().orElse("");
    }

    static final String LOCAL_OWNER_EMAIL = "owner@lupin.local";

    /**
     * A staff login for the local demo database only. The password is random, generated on this
     * machine on first run and kept in the git-ignored file backend/.local-owner-password.
     */
    private static String localOwnerPassword() throws java.io.IOException {
        Path file = Path.of(".local-owner-password").toAbsolutePath();
        if (java.nio.file.Files.exists(file)) {
            return java.nio.file.Files.readString(file).trim();
        }
        byte[] random = new byte[18];
        new SecureRandom().nextBytes(random);
        String password = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        java.nio.file.Files.writeString(file, password);
        return password;
    }
}
