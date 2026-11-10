package store.lupinwear.auth.infra;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import store.lupinwear.auth.domain.Role;

public interface RoleRepository extends JpaRepository<Role, Short> {

    Optional<Role> findByCode(String code);
}
