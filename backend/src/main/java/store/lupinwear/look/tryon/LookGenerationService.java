package store.lupinwear.look.tryon;

import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import store.lupinwear.audit.AuditLog;
import store.lupinwear.look.LookAdminService;
import store.lupinwear.look.LookDtos.AdminLookItem;
import store.lupinwear.look.LookDtos.AiStatus;
import store.lupinwear.look.LookDtos.GenerationView;
import store.lupinwear.look.tryon.TryOnGenerator.Garment;
import store.lupinwear.look.tryon.TryOnGenerator.Image;
import store.lupinwear.look.tryon.TryOnGenerator.TryOnException;
import store.lupinwear.shared.ApiException;

/**
 * Runs AI photo generation for a look in the background (it takes from several seconds to a few
 * minutes) and keeps the candidates until a staff member approves one. Nothing here reaches shoppers:
 * the approved image is uploaded to photo storage by the dashboard and set on the look like any photo.
 */
@Service
public class LookGenerationService {

    private static final Logger log = LoggerFactory.getLogger(LookGenerationService.class);
    /** Dressing order: the base garment first, the outer layer last. Accessories are not dressed. */
    private static final List<String> DRESS_ORDER = List.of("ONE_PIECE", "TOP", "BOTTOM", "OUTER");
    private static final Duration STALE_AFTER = Duration.ofMinutes(15);
    private static final int MAX_PHOTO_BYTES = 10 * 1024 * 1024;

    private final JdbcClient jdbc;
    private final LookAdminService looks;
    private final AuditLog audit;
    private final TryOnProperties props;
    private final TryOnGenerator generator;
    private final String publicBaseUrl;
    // HTTP/1.1: the default HTTP/2 upgrade request is refused by some servers (the local dev server among them).
    private final HttpClient photos = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final ExecutorService runner = Executors.newVirtualThreadPerTaskExecutor();

    public LookGenerationService(JdbcClient jdbc, LookAdminService looks, AuditLog audit, TryOnProperties props,
            @Value("${lupin.public-base-url}") String publicBaseUrl) {
        this.jdbc = jdbc;
        this.looks = looks;
        this.audit = audit;
        this.props = props;
        this.publicBaseUrl = publicBaseUrl.replaceAll("/+$", "");
        this.generator = props.fashnConfigured() ? new FashnTryOnGenerator(props)
                : props.localPreview() ? new LocalPreviewGenerator() : null;
    }

    @PreDestroy
    void stop() {
        runner.shutdownNow();
    }

    public AiStatus status() {
        return new AiStatus(generator != null, generator == null ? null : generator.provider(), props.candidateCount());
    }

    public GenerationView start(UUID actor, long lookId) {
        if (generator == null) {
            throw ApiException.conflict("AI_NOT_CONFIGURED",
                    "AI photos are not set up yet. Add the FASHN API key to the server's environment.");
        }
        List<AdminLookItem> items = looks.items(lookId);
        if (items.isEmpty()) {
            throw ApiException.notFound("Look");
        }
        List<AdminLookItem> worn = items.stream().filter(i -> DRESS_ORDER.contains(i.role()))
                .sorted(Comparator.comparingInt(i -> DRESS_ORDER.indexOf(i.role()))).toList();
        if (worn.isEmpty()) {
            throw ApiException.badRequest("NOTHING_TO_WEAR", "Add at least one top, bottom, one-piece or outer layer.");
        }
        for (AdminLookItem item : worn) {
            if (item.imageUrl() == null) {
                throw ApiException.badRequest("PHOTO_MISSING", "\"" + item.productNameEn() + "\" in " + item.colorNameEn()
                        + " has no product photo. The AI can only dress the model in real product photos.");
            }
        }
        jdbc.sql("delete from look_generations where created_at < now() - interval '7 days'").update();
        jdbc.sql("""
                update look_generations set status = 'FAILED', error = 'The run was interrupted. Try again.',
                       finished_at = now()
                where look_id = :l and status = 'RUNNING' and created_at < now() - make_interval(secs => :stale)
                """).param("l", lookId).param("stale", STALE_AFTER.toSeconds()).update();
        UUID id;
        try {
            id = jdbc.sql("""
                    insert into look_generations (look_id, provider, status, requested_by)
                    values (:l, :p, 'RUNNING', :u) returning id
                    """).param("l", lookId).param("p", generator.provider()).param("u", actor)
                    .query(UUID.class).single();
        } catch (org.springframework.dao.DuplicateKeyException e) {
            throw ApiException.conflict("GENERATION_RUNNING", "Photos for this look are already being made.");
        }
        audit.record(actor, "LOOK_AI_REQUESTED", "look", lookId, Map.of("generation", id.toString(),
                "provider", generator.provider()));
        runner.submit(() -> run(id, worn));
        return view(id).orElseThrow();
    }

    private void run(UUID id, List<AdminLookItem> worn) {
        try {
            List<Garment> garments = new ArrayList<>();
            for (AdminLookItem item : worn) {
                garments.add(new Garment(item.role(), item.productNameEn() + " (" + item.colorNameEn() + ")",
                        item.colorHex(), fetchPhoto(item.imageUrl())));
            }
            List<Image> images = generator.generate(garments, props.candidateCount());
            for (int i = 0; i < images.size() && i < 4; i++) {
                Image image = images.get(i);
                String type = "image/png".equals(image.contentType()) ? "image/png" : "image/jpeg";
                jdbc.sql("""
                        insert into look_generation_images (generation_id, position, content_type, bytes)
                        values (:g, :p, :t, :b)
                        """).param("g", id).param("p", i).param("t", type).param("b", image.bytes()).update();
            }
            jdbc.sql("update look_generations set status = 'DONE', finished_at = now() where id = :id")
                    .param("id", id).update();
        } catch (TryOnException e) {
            fail(id, e.getMessage());
        } catch (RuntimeException e) {
            log.error("Look photo generation {} failed", id, e);
            fail(id, "Something went wrong while making the photos. Try again.");
        }
    }

    private void fail(UUID id, String message) {
        String text = message == null ? "Failed." : message.length() > 500 ? message.substring(0, 500) : message;
        jdbc.sql("update look_generations set status = 'FAILED', error = :e, finished_at = now() where id = :id")
                .param("e", text).param("id", id).update();
    }

    /** Product photos are our own uploads, served by the storefront; full addresses are used as they are. */
    Image fetchPhoto(String url) {
        String address = url.startsWith("/") ? publicBaseUrl + url : url;
        // Only the store's own address (or Cloudinary, the earlier photo host): never an arbitrary URL.
        if (!url.startsWith("/") && !address.startsWith(publicBaseUrl + "/") && !address.startsWith("https://res.cloudinary.com/")) {
            throw new TryOnException("A product photo is not stored on this site, so it cannot be used.");
        }
        try {
            HttpResponse<byte[]> response = photos.send(HttpRequest.newBuilder(URI.create(address))
                    .timeout(Duration.ofSeconds(30)).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
            byte[] body = response.body();
            if (response.statusCode() != 200 || body == null || body.length == 0 || body.length > MAX_PHOTO_BYTES) {
                throw new TryOnException("A product photo could not be read (" + response.statusCode() + ").");
            }
            String type = response.headers().firstValue("Content-Type").orElse("image/jpeg").split(";")[0].trim();
            return new Image(body, type);
        } catch (java.io.IOException e) {
            log.warn("Could not read product photo {}: {}", address, e.toString());
            throw new TryOnException("A product photo could not be read.", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new TryOnException("Stopped while reading a product photo.");
        }
    }

    public Optional<GenerationView> latest(long lookId) {
        return jdbc.sql("select id from look_generations where look_id = :l order by created_at desc limit 1")
                .param("l", lookId).query(UUID.class).optional().flatMap(this::view);
    }

    /** A run left RUNNING by a restart is reported as failed instead of spinning forever. */
    private Optional<GenerationView> view(UUID id) {
        return jdbc.sql("""
                select g.id, g.status, g.provider, g.error, g.created_at, g.finished_at,
                       g.status = 'RUNNING' and g.created_at < now() - make_interval(secs => :stale) as stale,
                       (select count(*) from look_generation_images i where i.generation_id = g.id) as images
                from look_generations g where g.id = :id
                """).param("id", id).param("stale", STALE_AFTER.toSeconds())
                .query((rs, n) -> {
                    boolean stale = rs.getBoolean("stale");
                    return new GenerationView(rs.getObject("id", UUID.class), stale ? "FAILED" : rs.getString("status"),
                            rs.getString("provider"), stale ? "The run was interrupted. Try again." : rs.getString("error"),
                            rs.getInt("images"), rs.getTimestamp("created_at").toInstant(),
                            rs.getTimestamp("finished_at") == null ? null : rs.getTimestamp("finished_at").toInstant());
                }).optional();
    }

    public Image candidate(long lookId, UUID generationId, int position) {
        return jdbc.sql("""
                select i.content_type, i.bytes from look_generation_images i
                join look_generations g on g.id = i.generation_id
                where g.look_id = :l and g.id = :g and i.position = :p
                """).param("l", lookId).param("g", generationId).param("p", position)
                .query((rs, n) -> new Image(rs.getBytes("bytes"), rs.getString("content_type")))
                .optional().orElseThrow(() -> ApiException.notFound("Image"));
    }
}
