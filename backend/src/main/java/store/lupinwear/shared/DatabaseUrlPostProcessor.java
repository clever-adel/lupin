package store.lupinwear.shared;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

/**
 * Lets the database be configured with the one connection string that Neon (and most hosts) hand
 * out: {@code postgresql://user:password@host/db?sslmode=require}. Java's driver wants a
 * {@code jdbc:postgresql://} address with the user and password given separately, so this splits
 * the string at start-up. The older three-variable form keeps working unchanged.
 *
 * {@code DATABASE_URL_UNPOOLED} is preferred when present: the application keeps its own small pool
 * and the schema migrations need a direct connection.
 *
 * Nothing here logs or exposes the value.
 */
public class DatabaseUrlPostProcessor implements EnvironmentPostProcessor {

    public record Jdbc(String url, String username, String password) {
    }

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        String raw = Optional.ofNullable(environment.getProperty("DATABASE_URL_UNPOOLED")).filter(s -> !s.isBlank())
                .orElse(environment.getProperty("DATABASE_URL"));
        parse(raw).ifPresent(jdbc -> {
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("spring.datasource.url", jdbc.url());
            if (jdbc.username() != null && environment.getProperty("DATABASE_USERNAME") == null) {
                values.put("spring.datasource.username", jdbc.username());
            }
            if (jdbc.password() != null && environment.getProperty("DATABASE_PASSWORD") == null) {
                values.put("spring.datasource.password", jdbc.password());
            }
            // Below command-line arguments and real environment variables, above application.yml.
            environment.getPropertySources().addAfter(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME,
                    new MapPropertySource("databaseUrl", values));
        });
    }

    /** Empty when the value is missing or already a JDBC address. */
    public static Optional<Jdbc> parse(String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        String value = raw.trim();
        if (value.length() > 1 && value.startsWith("\"") && value.endsWith("\"")) {
            value = value.substring(1, value.length() - 1);
        }
        if (!value.startsWith("postgres://") && !value.startsWith("postgresql://")) {
            return Optional.empty();
        }
        URI uri;
        try {
            uri = URI.create(value);
        } catch (IllegalArgumentException e) {
            // The parser's own message would repeat the whole address, password included.
            throw new IllegalStateException("DATABASE_URL is not a valid postgresql:// address.");
        }
        if (uri.getHost() == null || uri.getPath() == null || uri.getPath().length() < 2) {
            throw new IllegalStateException("DATABASE_URL is not a valid postgresql:// address (host or database missing).");
        }
        String username = null;
        String password = null;
        String userInfo = uri.getRawUserInfo();
        if (userInfo != null) {
            int colon = userInfo.indexOf(':');
            username = decode(colon < 0 ? userInfo : userInfo.substring(0, colon));
            password = colon < 0 ? null : decode(userInfo.substring(colon + 1));
        }
        // Only the encryption setting is carried over; everything else the driver negotiates itself.
        String sslMode = "require";
        if (uri.getRawQuery() != null) {
            for (String pair : uri.getRawQuery().split("&")) {
                if (pair.startsWith("sslmode=") && pair.length() > 8) {
                    sslMode = decode(pair.substring(8));
                }
            }
        }
        String url = "jdbc:postgresql://" + uri.getHost() + (uri.getPort() > 0 ? ":" + uri.getPort() : "")
                + uri.getRawPath() + "?sslmode=" + sslMode;
        return Optional.of(new Jdbc(url, username, password));
    }

    private static String decode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }
}
