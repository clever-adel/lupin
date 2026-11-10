package store.lupinwear.auth.infra;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import store.lupinwear.auth.domain.AuthSession;

public interface AuthSessionRepository extends JpaRepository<AuthSession, UUID> {

    Optional<AuthSession> findByTokenHash(String tokenHash);

    /** Returns 1 only for the first caller: a refresh token can be exchanged exactly once. */
    @Modifying(clearAutomatically = true)
    @Query("update AuthSession s set s.rotatedAt = :now where s.id = :id and s.rotatedAt is null and s.revokedAt is null")
    int markRotated(UUID id, Instant now);

    @Modifying(clearAutomatically = true)
    @Query("update AuthSession s set s.revokedAt = :now where s.familyId = :familyId and s.revokedAt is null")
    int revokeFamily(UUID familyId, Instant now);

    @Modifying(clearAutomatically = true)
    @Query("update AuthSession s set s.revokedAt = :now where s.userId = :userId and s.revokedAt is null")
    int revokeAllForUser(UUID userId, Instant now);
}
