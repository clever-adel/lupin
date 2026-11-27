import { describe, expect, it } from "vitest";
import { estimateChest, recommendSize } from "./size-finder";
import type { SizeGuide } from "./types";

const bershka: SizeGuide = {
  kind: "BODY",
  rows: [
    { labelEn: "Chest", labelAr: "الصدر", values: { XS: "78-86", S: "86-94", M: "94-102", L: "102-110" } },
    { labelEn: "Waist", labelAr: "الوسط", values: { XS: "66-74", S: "74-82", M: "82-90", L: "90-98.5" } },
  ],
};
const sizes = ["XS", "S", "M", "L"];

describe("find my size", () => {
  it("estimates a typical chest from height and weight", () => {
    expect(Math.round(estimateChest(175, 70))).toBe(95);
    expect(Math.round(estimateChest(165, 60, "women"))).toBe(88);
  });

  it("picks the size whose chest range holds the estimate", () => {
    expect(recommendSize(bershka, sizes, 175, 70)).toEqual({ size: "M", fit: "in", chest: 95 });
    expect(recommendSize(bershka, sizes, 170, 60)?.size).toBe("S");
    expect(recommendSize(bershka, sizes, 182, 85)?.size).toBe("L");
  });

  it("says when the shopper is below the smallest or above the largest size", () => {
    expect(recommendSize(bershka, sizes, 150, 40)).toMatchObject({ size: "XS", fit: "below" });
    expect(recommendSize(bershka, sizes, 195, 120)).toMatchObject({ size: "L", fit: "above" });
  });

  it("only uses the sizes the product is sold in", () => {
    expect(recommendSize(bershka, ["M", "L"], 170, 60)).toMatchObject({ size: "M", fit: "below" });
  });

  it("gives no advice without a body chart with a chest row, or for impossible numbers", () => {
    expect(recommendSize({ ...bershka, kind: "GARMENT" }, sizes, 175, 70)).toBeNull();
    expect(recommendSize({ kind: "BODY", rows: [bershka.rows[1]!] }, sizes, 175, 70)).toBeNull();
    expect(recommendSize(bershka, sizes, 17.5, 70)).toBeNull();
    expect(recommendSize(bershka, sizes, 175, 700)).toBeNull();
    expect(recommendSize(null, sizes, 175, 70)).toBeNull();
  });
});
