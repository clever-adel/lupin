package store.lupinwear.notify;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

/** Decrypts as a browser would (RFC 8291) and checks the VAPID token as a push service would. */
public class WebPushUnitTest {

    /** The browser's side: what Chrome or Safari do with a message they receive. */
    public static String decrypt(byte[] message, KeyPair browser, byte[] auth) throws Exception {
        ByteBuffer in = ByteBuffer.wrap(message);
        byte[] salt = new byte[16];
        in.get(salt);
        assertThat(in.getInt()).isEqualTo(4096);
        byte[] serverKey = new byte[in.get()];
        in.get(serverKey);
        byte[] ciphertext = new byte[in.remaining()];
        in.get(ciphertext);

        ECPublicKey browserPublic = (ECPublicKey) browser.getPublic();
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(browser.getPrivate());
        agreement.doPhase(WebPush.publicKey(serverKey, browserPublic.getParams()), true);
        byte[] keyInfo = WebPush.concat("WebPush: info".getBytes(StandardCharsets.US_ASCII), new byte[] {0},
                WebPush.raw(browserPublic), serverKey);
        byte[] ikm = WebPush.hkdf(auth, agreement.generateSecret(), keyInfo, 32);
        byte[] cek = WebPush.hkdf(salt, ikm, "Content-Encoding: aes128gcm\0".getBytes(StandardCharsets.US_ASCII), 16);
        byte[] nonce = WebPush.hkdf(salt, ikm, "Content-Encoding: nonce\0".getBytes(StandardCharsets.US_ASCII), 12);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
        byte[] plain = cipher.doFinal(ciphertext);
        assertThat(plain[plain.length - 1]).isEqualTo((byte) 2);
        return new String(plain, 0, plain.length - 1, StandardCharsets.UTF_8);
    }

    @Test
    void onlyTheBrowserWithTheMatchingKeysCanReadTheMessage() throws Exception {
        KeyPair browser = WebPush.newKeyPair();
        byte[] auth = new byte[16];
        new SecureRandom().nextBytes(auth);
        String text = "{\"title\":\"طلب جديد LP-1001\"}";

        byte[] message = WebPush.encrypt(text.getBytes(StandardCharsets.UTF_8), WebPush.raw((ECPublicKey) browser.getPublic()), auth);
        assertThat(decrypt(message, browser, auth)).isEqualTo(text);

        byte[] otherAuth = auth.clone();
        otherAuth[0] ^= 1;
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> decrypt(message, browser, otherAuth))
                .isInstanceOf(javax.crypto.AEADBadTagException.class);
    }

    @Test
    void theVapidTokenIsSignedForThePushServiceOnly() throws Exception {
        KeyPair store = WebPush.newKeyPair();
        byte[] publicRaw = WebPush.raw((ECPublicKey) store.getPublic());
        String header = WebPush.vapidHeader("https://fcm.googleapis.com/fcm/send/abc", (ECPrivateKey) store.getPrivate(),
                publicRaw, "https://lupinwear.store", Instant.parse("2026-11-18T10:00:00Z"));

        assertThat(header).startsWith("vapid t=").endsWith(", k=" + WebPush.b64(publicRaw));
        String jwt = header.substring("vapid t=".length(), header.indexOf(", k="));
        String[] parts = jwt.split("\\.");
        String claims = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
        assertThat(claims).contains("\"aud\":\"https://fcm.googleapis.com\"").contains("\"sub\":\"https://lupinwear.store\"")
                .contains("\"exp\":" + Instant.parse("2026-11-18T22:00:00Z").getEpochSecond());

        Signature verifier = Signature.getInstance("SHA256withECDSAinP1363Format");
        verifier.initVerify(store.getPublic());
        verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        assertThat(verifier.verify(Base64.getUrlDecoder().decode(parts[2]))).isTrue();
    }

    @Test
    void onlyTheBigPushServicesAreAccepted() {
        assertThat(StaffPush.allowed("https://fcm.googleapis.com/fcm/send/x")).isTrue();
        assertThat(StaffPush.allowed("https://web.push.apple.com/QGx")).isTrue();
        assertThat(StaffPush.allowed("https://updates.push.services.mozilla.com/wpush/v2/x")).isTrue();
        assertThat(StaffPush.allowed("http://fcm.googleapis.com/fcm/send/x")).isFalse();
        assertThat(StaffPush.allowed("https://evil.example/fcm.googleapis.com")).isFalse();
        assertThat(StaffPush.allowed("https://googleapis.com.evil.example/x")).isFalse();
        assertThat(StaffPush.allowed("https://fcm.googleapis.com:8443/x")).isFalse();
        assertThat(StaffPush.allowed("https://169.254.169.254/latest")).isFalse();
    }

    @Test
    void severalWhatsAppNumbersAreReadOnceEach() {
        assertThat(NewOrderNotifier.phones("01012345678, 0111 222 3334\n01012345678;123"))
                .containsExactly("01012345678", "01112223334");
        assertThat(NewOrderNotifier.phones("")).isEmpty();
        assertThat(Arrays.asList(1)).hasSize(1);
    }
}
