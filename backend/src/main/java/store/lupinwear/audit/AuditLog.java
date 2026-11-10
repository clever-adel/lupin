package store.lupinwear.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** Append-only record of sensitive staff actions. Written in the caller's transaction. */
@Service
public class AuditLog {

    private final JdbcClient jdbc;
    private final ObjectMapper json;

    public AuditLog(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public void record(UUID actor, String action, String entityType, Object entityId, Object detail) {
        String body;
        try {
            body = detail == null ? null : json.writeValueAsString(detail);
        } catch (JsonProcessingException e) {
            body = null;
        }
        jdbc.sql("""
                insert into audit_logs (actor_user_id, action, entity_type, entity_id, detail)
                values (:actor, :action, :type, :id, cast(:detail as jsonb))
                """)
                .param("actor", actor)
                .param("action", action)
                .param("type", entityType)
                .param("id", entityId == null ? null : String.valueOf(entityId))
                .param("detail", body)
                .update();
    }
}
