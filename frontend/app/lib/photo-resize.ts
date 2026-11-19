import { PHOTO_WIDTHS } from "./photo-sizes";

/**
 * Makes the WebP copy of a photo at every width in PHOTO_WIDTHS, in this browser. A photo narrower than a
 * width keeps its own width for that copy (never enlarged). Returns null where this browser cannot write
 * WebP (older Safari); the store then keeps showing the original, which still works.
 */
export async function makePhotoSizes(photo: Blob): Promise<Map<number, Blob> | null> {
  const bitmap = await createImageBitmap(photo);
  try {
    const sizes = new Map<number, Blob>();
    for (const width of PHOTO_WIDTHS) {
      const w = Math.min(width, bitmap.width);
      const h = Math.max(1, Math.round((bitmap.height * w) / bitmap.width));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
      if (!blob || blob.type !== "image/webp") return null;
      sizes.set(width, blob);
    }
    return sizes;
  } finally {
    bitmap.close();
  }
}
