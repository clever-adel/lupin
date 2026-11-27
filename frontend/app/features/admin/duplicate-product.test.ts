import { describe, expect, it } from "vitest";
import { copyRequest } from "./duplicate-product";

const product = {
  nameEn: "The Blackout", nameAr: "ذا بلاك آوت", departmentSlug: "men", categorySlug: "hoodie",
  descriptionEn: "d", descriptionAr: "و", fabricEn: "f", fabricAr: "ق", fitEn: "Boxy", fitAr: "بوكسي",
  brand: "Bershka", badge: "", price: 900, salePrice: 690,
  colors: [{ nameEn: "Black", nameAr: "أسود", hex: "#000000", main: false }, { nameEn: "White", nameAr: "أبيض", hex: "#FFFFFF", main: true }],
  sizes: ["M", "L"],
};

describe("duplicate product", () => {
  it("copies details, sizes and colours without photos or stock, as a renamed draft", () => {
    const r = copyRequest(product);
    expect(r.nameEn).toBe("The Blackout (copy)");
    expect(r.nameAr).toBe("ذا بلاك آوت (نسخة)");
    expect(r).toMatchObject({ categorySlug: "hoodie", brand: "Bershka", price: 900, salePrice: 690, sizeGroup: "ADULT", sizes: ["M", "L"], initialStockPerVariant: 0, badge: null });
    expect(r.colors).toEqual([
      { nameEn: "Black", nameAr: "أسود", hex: "#000000", main: false, images: [] },
      { nameEn: "White", nameAr: "أبيض", hex: "#FFFFFF", main: true, images: [] },
    ]);
  });

  it("knows kids sizes and always has one main colour", () => {
    const r = copyRequest({ ...product, sizes: ["4-5Y"], colors: [{ nameEn: "Red", nameAr: "أحمر", hex: "#FF0000" }] });
    expect(r.sizeGroup).toBe("KIDS");
    expect(r.colors[0]!.main).toBe(true);
  });
});
