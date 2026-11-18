package store.lupinwear.notify;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * The two pieces of Web Push done with the JDK alone: the message encryption (RFC 8291,
 * "aes128gcm") so only the staff member's browser can read it, and the VAPID signature (RFC 8292)
 * that identifies this store to the push service.
 */
public final class WebPush {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder B64URL = Base64.getUrlEncoder().withoutPadding();

    public static String b64(byte[] bytes) {
        return B64URL.encodeToString(bytes);
    }
    private static final Base64.Decoder B64URL_DECODE = Base64.getUrlDecoder();

    private WebPush() {
    }

    public static KeyPair newKeyPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(new ECGenParameterSpec("secp256r1"), RANDOM);
            return generator.generateKeyPair();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The 65-byte uncompressed point (0x04 || X || Y) that browsers use. */
    public static byte[] raw(ECPublicKey key) {
        byte[] out = new byte[65];
        out[0] = 4;
        copy32(key.getW().getAffineX(), out, 1);
        copy32(key.getW().getAffineY(), out, 33);
        return out;
    }

    public static ECPublicKey publicKey(byte[] raw, ECParameterSpec params) throws GeneralSecurityException {
        if (raw.length != 65 || raw[0] != 4) {
            throw new GeneralSecurityException("Not an uncompressed P-256 point");
        }
        ECPoint point = new ECPoint(new BigInteger(1, Arrays.copyOfRange(raw, 1, 33)),
                new BigInteger(1, Arrays.copyOfRange(raw, 33, 65)));
        return (ECPublicKey) KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(point, params));
    }

    public static ECPrivateKey privateKey(byte[] pkcs8) throws GeneralSecurityException {
        return (ECPrivateKey) KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
    }

    /** Browsers hand out keys in base64url, sometimes padded; accept both alphabets. */
    public static byte[] unb64(String value) {
        return B64URL_DECODE.decode(value.trim().replace('+', '-').replace('/', '_').replace("=", ""));
    }

    /**
     * Encrypts {@code payload} for one browser. {@code p256dh} and {@code auth} are the keys from its
     * PushSubscription. The result is the whole request body (header and one record).
     */
    public static byte[] encrypt(byte[] payload, byte[] p256dh, byte[] auth) throws GeneralSecurityException {
        KeyPair ephemeral = newKeyPair();
        ECPublicKey asPublic = (ECPublicKey) ephemeral.getPublic();
        ECPublicKey uaPublic = publicKey(p256dh, asPublic.getParams());

        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(ephemeral.getPrivate());
        agreement.doPhase(uaPublic, true);
        byte[] ecdhSecret = agreement.generateSecret();

        byte[] asRaw = raw(asPublic);
        byte[] keyInfo = concat("WebPush: info".getBytes(StandardCharsets.US_ASCII), new byte[] {0}, p256dh, asRaw);
        byte[] ikm = hkdf(auth, ecdhSecret, keyInfo, 32);

        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        byte[] cek = hkdf(salt, ikm, concat("Content-Encoding: aes128gcm".getBytes(StandardCharsets.US_ASCII),
                new byte[] {0}), 16);
        byte[] nonce = hkdf(salt, ikm, concat("Content-Encoding: nonce".getBytes(StandardCharsets.US_ASCII),
                new byte[] {0}), 12);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
        byte[] encrypted = cipher.doFinal(concat(payload, new byte[] {2})); // 0x02: the last (only) record

        ByteBuffer header = ByteBuffer.allocate(16 + 4 + 1 + asRaw.length);
        header.put(salt).putInt(4096).put((byte) asRaw.length).put(asRaw);
        return concat(header.array(), encrypted);
    }

    /** "vapid t=<signed JWT>, k=<public key>" for one push service (the JWT's audience is its origin). */
    public static String vapidHeader(String endpoint, ECPrivateKey key, byte[] publicRaw, String subject, Instant now)
            throws GeneralSecurityException {
        URI uri = URI.create(endpoint);
        String audience = uri.getScheme() + "://" + uri.getHost() + (uri.getPort() > 0 ? ":" + uri.getPort() : "");
        String header = b64("{\"typ\":\"JWT\",\"alg\":\"ES256\"}".getBytes(StandardCharsets.UTF_8));
        String claims = b64(("{\"aud\":\"" + audience + "\",\"exp\":" + now.plusSeconds(12 * 3600).getEpochSecond()
                + ",\"sub\":\"" + subject.replace("\"", "") + "\"}").getBytes(StandardCharsets.UTF_8));
        Signature signer = Signature.getInstance("SHA256withECDSAinP1363Format");
        signer.initSign(key);
        signer.update((header + "." + claims).getBytes(StandardCharsets.US_ASCII));
        return "vapid t=" + header + "." + claims + "." + b64(signer.sign()) + ", k=" + b64(publicRaw);
    }

    /** HKDF-SHA-256 with a single expand block (every length used here is at most 32). */
    static byte[] hkdf(byte[] salt, byte[] ikm, byte[] info, int length) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(ikm);
        mac.init(new SecretKeySpec(prk, "HmacSHA256"));
        mac.update(info);
        mac.update((byte) 1);
        return Arrays.copyOf(mac.doFinal(), length);
    }

    private static void copy32(BigInteger value, byte[] out, int offset) {
        byte[] bytes = value.toByteArray();
        int start = Math.max(0, bytes.length - 32);
        int length = bytes.length - start;
        System.arraycopy(bytes, start, out, offset + 32 - length, length);
    }

    static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] part : parts) {
            out.writeBytes(part);
        }
        return out.toByteArray();
    }
}
