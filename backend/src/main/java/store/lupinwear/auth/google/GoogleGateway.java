package store.lupinwear.auth.google;

/** Talks to Google's token endpoint. A fake stands in for it in tests. */
public interface GoogleGateway {

    /** Who signed in, from the ID token Google returned. */
    record Profile(String subject, String email, boolean emailVerified, String name) {
    }

    /** Exchanges the one-time code for the person's verified profile. Throws if Google refuses it. */
    Profile exchange(String code, String codeVerifier, String redirectUri);
}
