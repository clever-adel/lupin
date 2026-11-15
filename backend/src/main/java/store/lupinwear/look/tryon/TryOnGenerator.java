package store.lupinwear.look.tryon;

import java.util.List;

/** Dresses a model in real product photos. Implementations never invent garments of their own. */
public interface TryOnGenerator {

    /** FASHN or LOCAL_PREVIEW; stored with each run. */
    String provider();

    /**
     * @param garments what the model wears, in dressing order; accessories are not passed
     * @param candidates how many alternative images to return (1 to 4)
     */
    List<Image> generate(List<Garment> garments, int candidates);

    /** {@code role} is TOP, BOTTOM, ONE_PIECE or OUTER. {@code hex} is the colour, for previews. */
    record Garment(String role, String name, String hex, Image photo) {
    }

    record Image(byte[] bytes, String contentType) {
    }

    /** A failure staff can read and act on; the message is shown in the dashboard as it is. */
    class TryOnException extends RuntimeException {
        public TryOnException(String message) {
            super(message);
        }

        public TryOnException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
