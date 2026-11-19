import { describe, expect, it } from "vitest";
import { isPhotoWidth, photoSrcSet, photoUrl, sizedKey } from "./photo-sizes";

const id = "431be14f-3841-4def-b0ba-15704d184a2c";

describe("photo sizes", () => {
  it("names each copy after the photo, as WebP", () => {
    expect(sizedKey(`${id}.jpg`, 480)).toBe(`${id}.w480.webp`);
    expect(sizedKey(`${id}.webp`, 1280)).toBe(`${id}.w1280.webp`);
  });

  it("asks the store for a width, and lists every width for the browser to choose from", () => {
    expect(photoUrl(`/media/${id}.jpg`, 640)).toBe(`/media/${id}.jpg?w=640`);
    expect(photoSrcSet(`/media/${id}.jpg`)).toBe(
      [320, 480, 640, 960, 1280].map((w) => `/media/${id}.jpg?w=${w} ${w}w`).join(", "),
    );
  });

  it("keeps Cloudinary resizing for old photos and leaves other addresses alone", () => {
    expect(photoUrl("https://res.cloudinary.com/x/image/upload/v1/a.jpg", 320)).toBe(
      "https://res.cloudinary.com/x/image/upload/f_auto,q_auto,c_limit,w_320/v1/a.jpg",
    );
    expect(photoUrl("/brand/lupin-mark.png", 320)).toBe("/brand/lupin-mark.png");
    expect(photoSrcSet("/brand/lupin-mark.png")).toBeUndefined();
  });

  it("accepts only the widths that have copies", () => {
    expect(isPhotoWidth(480)).toBe(true);
    expect(isPhotoWidth(500)).toBe(false);
    expect(isPhotoWidth(Number("abc"))).toBe(false);
  });
});
