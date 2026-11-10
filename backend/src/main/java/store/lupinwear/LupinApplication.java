package store.lupinwear;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class LupinApplication {

    public static void main(String[] args) {
        SpringApplication.run(LupinApplication.class, args);
    }
}
