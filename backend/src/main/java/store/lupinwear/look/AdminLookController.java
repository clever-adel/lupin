package store.lupinwear.look;

import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import store.lupinwear.look.LookDtos.AdminLookDetail;
import store.lupinwear.look.LookDtos.AdminLookRow;
import store.lupinwear.look.LookDtos.AiStatus;
import store.lupinwear.look.LookDtos.GenerationView;
import store.lupinwear.look.LookDtos.LookCreated;
import store.lupinwear.look.LookDtos.LookImageRequest;
import store.lupinwear.look.LookDtos.LookRequest;
import store.lupinwear.look.LookDtos.LookStatusRequest;
import store.lupinwear.look.tryon.LookGenerationService;
import store.lupinwear.look.tryon.TryOnGenerator.Image;
import store.lupinwear.security.CurrentUser;

/** Staff only. Guarded twice: the /api/v1/admin/** URL rule and the class-level role check. */
@RestController
@RequestMapping("/api/v1/admin/looks")
@PreAuthorize("hasAnyRole('ADMIN','OWNER')")
public class AdminLookController {

    private final LookAdminService looks;
    private final LookGenerationService ai;

    public AdminLookController(LookAdminService looks, LookGenerationService ai) {
        this.looks = looks;
        this.ai = ai;
    }

    @GetMapping
    List<AdminLookRow> looks() {
        return looks.looks();
    }

    @GetMapping("/ai")
    AiStatus aiStatus() {
        return ai.status();
    }

    @GetMapping("/{id}")
    AdminLookDetail look(@PathVariable long id) {
        return looks.look(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    LookCreated create(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody LookRequest body) {
        return looks.create(user.id(), body);
    }

    @PutMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void update(@AuthenticationPrincipal CurrentUser user, @PathVariable long id, @Valid @RequestBody LookRequest body) {
        looks.update(user.id(), id, body);
    }

    @PutMapping("/{id}/image")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void image(@AuthenticationPrincipal CurrentUser user, @PathVariable long id,
            @Valid @RequestBody LookImageRequest body) {
        looks.setImage(user.id(), id, body);
    }

    @PatchMapping("/{id}/status")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void status(@AuthenticationPrincipal CurrentUser user, @PathVariable long id,
            @Valid @RequestBody LookStatusRequest body) {
        looks.setStatus(user.id(), id, body.status());
    }

    /** Returns the stored photo id so the dashboard can remove the file from photo storage. */
    @DeleteMapping("/{id}")
    Map<String, String> delete(@AuthenticationPrincipal CurrentUser user, @PathVariable long id) {
        String publicId = looks.delete(user.id(), id);
        return publicId == null ? Map.of() : Map.of("imagePublicId", publicId);
    }

    @PostMapping("/{id}/generations")
    @ResponseStatus(HttpStatus.ACCEPTED)
    GenerationView generate(@AuthenticationPrincipal CurrentUser user, @PathVariable long id) {
        return ai.start(user.id(), id);
    }

    @GetMapping("/{id}/generations/latest")
    ResponseEntity<GenerationView> latest(@PathVariable long id) {
        return ai.latest(id).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @GetMapping("/{id}/generations/{generationId}/images/{position}")
    ResponseEntity<byte[]> candidate(@PathVariable long id, @PathVariable UUID generationId,
            @PathVariable int position) {
        Image image = ai.candidate(id, generationId, position);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.contentType()))
                .cacheControl(CacheControl.noStore()).header("X-Content-Type-Options", "nosniff")
                .body(image.bytes());
    }
}
