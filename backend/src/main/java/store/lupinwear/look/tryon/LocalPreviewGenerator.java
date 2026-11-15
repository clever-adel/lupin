package store.lupinwear.look.tryon;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import javax.imageio.ImageIO;

/**
 * Development only: a clearly labelled board of the real product photos, so the whole flow (generate,
 * compare, approve, publish) can be tried without an AI account. It never pretends to be a model photo.
 */
public class LocalPreviewGenerator implements TryOnGenerator {

    static final int WIDTH = 864;
    static final int HEIGHT = 1296;

    @Override
    public String provider() {
        return "LOCAL_PREVIEW";
    }

    @Override
    public List<Image> generate(List<Garment> garments, int candidates) {
        List<Image> out = new ArrayList<>();
        for (int i = 0; i < candidates; i++) {
            out.add(render(garments, i));
        }
        return out;
    }

    private static Image render(List<Garment> garments, int variant) {
        BufferedImage canvas = new BufferedImage(WIDTH, HEIGHT, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = canvas.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setColor(variant % 2 == 0 ? new Color(0xF6F5F1) : new Color(0xEFEFEF));
            g.fillRect(0, 0, WIDTH, HEIGHT);

            int top = 150;
            int bottom = HEIGHT - 140;
            int slot = (bottom - top) / Math.max(garments.size(), 1);
            for (int i = 0; i < garments.size(); i++) {
                Garment garment = garments.get(i);
                int y = top + i * slot;
                BufferedImage photo = decode(garment.photo());
                int boxW = WIDTH - 220;
                int boxH = slot - 30;
                if (photo != null) {
                    double scale = Math.min((double) boxW / photo.getWidth(), (double) boxH / photo.getHeight());
                    int w = (int) (photo.getWidth() * scale);
                    int h = (int) (photo.getHeight() * scale);
                    g.drawImage(photo, (WIDTH - w) / 2, y + (boxH - h) / 2, w, h, null);
                } else {
                    g.setColor(parse(garment.hex()));
                    g.fillRect(110, y, boxW, boxH);
                }
                g.setColor(new Color(0x62605B));
                g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 20));
                g.drawString(garment.role() + " · " + garment.name(), 110, y + boxH + 22);
            }

            g.setColor(new Color(0xB3261E));
            g.setStroke(new BasicStroke(4));
            g.drawRect(12, 12, WIDTH - 24, HEIGHT - 24);
            g.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 30));
            g.drawString("LOCAL TEST IMAGE — NOT AI", 110, 70);
            g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 20));
            g.drawString("Option " + (variant + 1) + ". Add FASHN_API_KEY for real model photos.", 110, 105);
        } finally {
            g.dispose();
        }
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            ImageIO.write(canvas, "jpg", bytes);
            return new Image(bytes.toByteArray(), "image/jpeg");
        } catch (IOException e) {
            throw new TryOnException("Could not draw the test image.", e);
        }
    }

    /** JPEG and PNG only; other formats (WebP, AVIF) are shown as a colour block. */
    private static BufferedImage decode(Image image) {
        if (image == null) {
            return null;
        }
        try {
            return ImageIO.read(new ByteArrayInputStream(image.bytes()));
        } catch (IOException e) {
            return null;
        }
    }

    private static Color parse(String hex) {
        try {
            return Color.decode(hex);
        } catch (RuntimeException e) {
            return Color.LIGHT_GRAY;
        }
    }
}
