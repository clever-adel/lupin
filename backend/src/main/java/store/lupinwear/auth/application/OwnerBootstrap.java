package store.lupinwear.auth.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import store.lupinwear.auth.domain.Role;
import store.lupinwear.auth.infra.UserRepository;

/**
 * There is no default admin account and no default password anywhere. The first owner is created
 * once, from two environment variables, and only while no owner exists. Remove the variables afterwards.
 */
@Component
class OwnerBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(OwnerBootstrap.class);

    private final UserRepository users;
    private final AuthService auth;
    private final String email;
    private final String password;

    OwnerBootstrap(UserRepository users, AuthService auth,
            @Value("${lupin.bootstrap.owner-email:}") String email,
            @Value("${lupin.bootstrap.owner-password:}") String password) {
        this.users = users;
        this.auth = auth;
        this.email = email;
        this.password = password;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (email.isBlank() || password.isBlank()) {
            return;
        }
        if (users.existsWithRole(Role.OWNER)) {
            log.warn("An owner already exists; LUPIN_BOOTSTRAP_OWNER_* is ignored and should be removed.");
            return;
        }
        auth.createStaff(email, password, "Store owner", Role.OWNER);
        log.info("Owner account created. Remove LUPIN_BOOTSTRAP_OWNER_* from the environment now.");
    }
}
