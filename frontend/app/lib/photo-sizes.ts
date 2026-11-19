/**
 * Phone-size copies of uploaded photos.
 *
 * Every photo uploaded to /media/<id>.<ext> also gets a WebP copy at each of these widths, made in the
 * dashboard (the browser) when the photo is uploaded and stored next to it as <id>.w<width>.webp.
 * Pages ask for /media/<id>.<ext>?w=<width>; the Worker answers with the copy, or with the original
 * while no copy exists, so a missing copy never shows a broken photo.
 */
export const PHOTO_WIDTHS = [320, 480, 640, 960, 1280] as const;

export type PhotoWidth = (typeof PHOTO_WIDTHS)[number];

export function isPhotoWidth(value: number): value is PhotoWidth {
  return (PHOTO_WIDTHS as readonly number[]).includes(value);
}

/** Storage key of one copy: "<id>.<ext>" → "<id>.w<width>.webp". */
export function sizedKey(key: string, width: PhotoWidth): string {
  return `${key.slice(0, key.lastIndexOf("."))}.w${width}.webp`;
}

/** Address of a photo at (about) the given width, in the best format available. */
export function photoUrl(url: string, width: PhotoWidth): string {
  if (url.startsWith("/media/") && !url.includes("?")) return `${url}?w=${width}`;
  // Photos added before the store kept its own copies were hosted on Cloudinary, which resizes on request.
  const marker = "/image/upload/";
  const at = url.indexOf(marker);
  if (at === -1) return url;
  const head = url.slice(0, at + marker.length);
  return `${head}f_auto,q_auto,c_limit,w_${width}/${url.slice(at + marker.length)}`;
}

/** srcset listing every width, for an <img> whose shown size is set by `sizes`. */
export function photoSrcSet(url: string): string | undefined {
  if (photoUrl(url, 320) === url) return undefined; // a photo hosted elsewhere: only one size exists
  return PHOTO_WIDTHS.map((w) => `${photoUrl(url, w)} ${w}w`).join(", ");
}
