import { describe, expect, it } from "vitest";
import { cardSlides } from "./department-card-photos";

describe("department card photos", () => {
  it("puts the owner's wide photo first, then the pieces, without repeats", () => {
    expect(cardSlides("/media/own.jpg", ["/media/a.jpg", "/media/b.jpg", "/media/a.jpg"])).toEqual([
      { url: "/media/own.jpg", kind: "campaign" },
      { url: "/media/a.jpg", kind: "piece" },
      { url: "/media/b.jpg", kind: "piece" },
    ]);
  });

  it("falls back to the single photo of an older answer, and is empty without photos", () => {
    expect(cardSlides(undefined, undefined, "/media/x.jpg")).toEqual([{ url: "/media/x.jpg", kind: "piece" }]);
    expect(cardSlides(undefined, [])).toEqual([]);
  });
});
