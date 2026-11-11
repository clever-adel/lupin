package store.lupinwear.shared;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import store.lupinwear.shared.DatabaseUrlPostProcessor.Jdbc;

/** Pure logic, no database. All values here are made up. */
class DatabaseUrlUnitTest {

    @Test
    void aNeonConnectionStringIsSplitIntoAddressUserAndPassword() {
        Jdbc jdbc = DatabaseUrlPostProcessor.parse(
                "postgresql://app_owner:s3cret@ep-example-123.eu-central-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require")
                .orElseThrow();
        assertThat(jdbc.url()).isEqualTo("jdbc:postgresql://ep-example-123.eu-central-1.aws.neon.tech/neondb?sslmode=require");
        assertThat(jdbc.username()).isEqualTo("app_owner");
        assertThat(jdbc.password()).isEqualTo("s3cret");
    }

    @Test
    void portsQuotesAndEncodedCharactersAreHandled() {
        Jdbc jdbc = DatabaseUrlPostProcessor.parse("\"postgres://user%40x:p%40ss%3Aw%2Frd@db.example.test:6543/shop\"").orElseThrow();
        assertThat(jdbc.url()).isEqualTo("jdbc:postgresql://db.example.test:6543/shop?sslmode=require");
        assertThat(jdbc.username()).isEqualTo("user@x");
        assertThat(jdbc.password()).isEqualTo("p@ss:w/rd");
    }

    @Test
    void encryptionIsRequiredUnlessTheAddressSaysOtherwise() {
        assertThat(DatabaseUrlPostProcessor.parse("postgresql://u:p@h/db").orElseThrow().url()).endsWith("?sslmode=require");
        assertThat(DatabaseUrlPostProcessor.parse("postgresql://u:p@h/db?sslmode=verify-full").orElseThrow().url())
                .endsWith("?sslmode=verify-full");
    }

    @Test
    void aJdbcAddressOrNothingIsLeftAlone() {
        assertThat(DatabaseUrlPostProcessor.parse("jdbc:postgresql://localhost:5432/lupin")).isEmpty();
        assertThat(DatabaseUrlPostProcessor.parse(null)).isEmpty();
        assertThat(DatabaseUrlPostProcessor.parse("  ")).isEmpty();
    }

    @Test
    void aBrokenAddressStopsStartUpWithoutEchoingIt() {
        assertThatThrownBy(() -> DatabaseUrlPostProcessor.parse("postgresql://user:topsecret@/"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageNotContaining("topsecret");
    }

    @Test
    void theDirectConnectionIsPreferredAndExplicitSettingsStillWin() {
        StandardEnvironment env = new StandardEnvironment();
        env.getPropertySources().addLast(new MapPropertySource("test", java.util.Map.of(
                "DATABASE_URL", "postgresql://u:p@pooled.example.test/db",
                "DATABASE_URL_UNPOOLED", "postgresql://u:p@direct.example.test/db",
                "DATABASE_USERNAME", "explicit_user")));

        new DatabaseUrlPostProcessor().postProcessEnvironment(env, new SpringApplication());

        assertThat(env.getProperty("spring.datasource.url")).isEqualTo("jdbc:postgresql://direct.example.test/db?sslmode=require");
        assertThat(env.getProperty("spring.datasource.password")).isEqualTo("p");
        // The separately supplied user name is not overridden by the one inside the address.
        assertThat(env.containsProperty("spring.datasource.username")).isFalse();
    }
}
