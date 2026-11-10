package store.lupinwear.auth.infra;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import store.lupinwear.auth.domain.User;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    boolean existsByPhone(String phone);

    @Query("select count(u) > 0 from User u join u.roles r where r.code = :role")
    boolean existsWithRole(String role);

    /** Atomic so that parallel wrong guesses cannot under-count. */
    @Modifying(clearAutomatically = true)
    @Query("update User u set u.failedLoginCount = u.failedLoginCount + 1 where u.id = :id")
    void incrementFailedLogins(UUID id);
}
