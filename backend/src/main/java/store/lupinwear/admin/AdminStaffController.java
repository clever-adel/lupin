package store.lupinwear.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.audit.AuditLog;
import store.lupinwear.auth.application.AuthService;
import store.lupinwear.security.CurrentUser;
import store.lupinwear.shared.ApiException;

/**
 * Who works on the dashboard. Owner only: an admin cannot create, disable or re-key staff accounts,
 * their own included. An owner cannot disable themselves, so the store can never be left with no
 * owner by a slip of the hand.
 */
@RestController
@RequestMapping("/api/v1/admin/staff")
@PreAuthorize("hasRole('OWNER')")
@Transactional
public class AdminStaffController {

    public record StaffView(UUID id, String email, String fullName, String role, String status, Instant lastLoginAt,
            boolean you) {
    }

    public record CreateRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Size(min = 2, max = 120) String fullName,
            @NotNull @Pattern(regexp = "ADMIN|OWNER") String role,
            @NotBlank @Size(min = 12, max = 128, message = "Use at least 12 characters") String password) {
    }

    public record StatusRequest(@NotNull @Pattern(regexp = "ACTIVE|DISABLED") String status) {
    }

    public record PasswordRequest(
            @NotBlank @Size(min = 12, max = 128, message = "Use at least 12 characters") String password) {
    }

    private static final String STAFF = """
            select u.id, u.email, u.full_name, u.status, u.last_login_at,
                   max(case when r.code = 'OWNER' then 2 else 1 end) as level
            from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
            where r.code in ('ADMIN', 'OWNER') and u.deleted_at is null
            """;

    private final JdbcClient jdbc;
    private final AuthService auth;
    private final AuditLog audit;

    public AdminStaffController(JdbcClient jdbc, AuthService auth, AuditLog audit) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.audit = audit;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<StaffView> list(@AuthenticationPrincipal CurrentUser user) {
        return jdbc.sql(STAFF + " group by u.id order by level desc, u.created_at")
                .query((rs, n) -> {
                    OffsetDateTime last = rs.getObject("last_login_at", OffsetDateTime.class);
                    UUID id = rs.getObject("id", UUID.class);
                    return new StaffView(id, rs.getString("email"), rs.getString("full_name"),
                            rs.getInt("level") == 2 ? "OWNER" : "ADMIN", rs.getString("status"),
                            last == null ? null : last.toInstant(), id.equals(user.id()));
                }).list();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, UUID> create(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody CreateRequest body) {
        UUID id = auth.createStaff(body.email(), body.password(), body.fullName().trim(), body.role()).getId();
        // The password is never written to the audit log.
        audit.record(user.id(), "STAFF_CREATE", "user", id, Map.of("email", body.email(), "role", body.role()));
        return Map.of("id", id);
    }

    /** Disabling ends the person's sessions at once; admin requests re-check the account on every call. */
    @PostMapping("/{id}/status")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void setStatus(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id,
            @Valid @RequestBody StatusRequest body) {
        requireOtherStaff(user, id);
        jdbc.sql("update users set status = :s, updated_at = now() where id = :id").param("s", body.status())
                .param("id", id).update();
        if ("DISABLED".equals(body.status())) {
            jdbc.sql("update auth_sessions set revoked_at = now() where user_id = :id and revoked_at is null")
                    .param("id", id).update();
        }
        audit.record(user.id(), "STAFF_STATUS", "user", id, Map.of("status", body.status()));
    }

    @PostMapping("/{id}/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resetPassword(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id,
            @Valid @RequestBody PasswordRequest body) {
        requireOtherStaff(user, id);
        auth.resetStaffPassword(id, body.password());
        audit.record(user.id(), "STAFF_PASSWORD_RESET", "user", id, null);
    }

    private void requireOtherStaff(CurrentUser actor, UUID id) {
        if (actor.id().equals(id)) {
            throw ApiException.badRequest("NOT_YOURSELF",
                    "You cannot do this to your own account. Change your own password from your account page.");
        }
        boolean staff = jdbc.sql("select count(*) from (" + STAFF + " and u.id = :id group by u.id) s")
                .param("id", id).query(Long.class).single() == 1;
        if (!staff) {
            // Customers are not managed here, whatever id is sent.
            throw ApiException.notFound("Staff member");
        }
    }
}
