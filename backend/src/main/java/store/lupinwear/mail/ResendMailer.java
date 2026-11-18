package store.lupinwear.mail;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Resend's HTTP API (POST /emails with a Bearer key), from resend.com/docs/api-reference/emails/send-email.
 * Without a key nothing is sent: local runs write the message to the log, other runs log a warning
 * without the message (it holds a one-time link).
 */
@Component
public class ResendMailer implements Mailer {

    private static final Logger log = LoggerFactory.getLogger(ResendMailer.class);

    private final MailProperties props;
    private final RestClient http;

    public ResendMailer(MailProperties props) {
        this.props = props;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(15));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    @Override
    public void send(Message message) {
        if (!props.configured()) {
            if (props.logLinks()) {
                log.info("Email not sent (no RESEND_API_KEY). To: {} | {}\n{}", message.to(), message.subject(), message.text());
            } else {
                log.warn("Email not sent: RESEND_API_KEY is not set ({}).", message.subject());
            }
            return;
        }
        try {
            http.post().uri(props.baseUrl() + "/emails")
                    .header("Authorization", "Bearer " + props.resendApiKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("from", props.from(), "to", List.of(message.to()), "subject", message.subject(),
                            "text", message.text(), "html", message.html()))
                    .retrieve().toBodilessEntity();
        } catch (RestClientException e) {
            log.error("Email could not be sent ({}): {}", message.subject(), e.getMessage());
        }
    }
}
