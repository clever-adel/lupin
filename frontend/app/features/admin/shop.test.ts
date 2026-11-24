import { describe, expect, it } from "vitest";
import { clampQuantity, linesTotal, normalizeNumber, priceOk } from "./shop";

describe("shop counter numbers", () => {
  it("reads Arabic and Persian digits and the Arabic decimal comma", () => {
    expect(normalizeNumber("١٧٥٠")).toBe("1750");
    expect(normalizeNumber("۱۲۰۰")).toBe("1200");
    expect(normalizeNumber("١٢٥٫٥٠")).toBe("125.50");
    expect(normalizeNumber("99,5")).toBe("99.5");
    expect(normalizeNumber(" 1 750 ")).toBe("1750");
    expect(normalizeNumber("١٬٧٥٠")).toBe("1750");
  });

  it("accepts only prices the server will take", () => {
    for (const ok of ["0", "1750", "1750.5", "1750.50", "999999.99"]) expect(priceOk(ok), ok).toBe(true);
    for (const bad of ["", "-5", "12.345", "abc", "1e3", "1000000", ".5", "١٧٥٠"]) expect(priceOk(bad), bad).toBe(false);
  });

  it("keeps quantities whole and within stock", () => {
    expect(clampQuantity(5, 3)).toBe(3);
    expect(clampQuantity(0, 3)).toBe(1);
    expect(clampQuantity(2.7, 10)).toBe(2);
    expect(clampQuantity(Number.NaN, 10)).toBe(1);
    expect(clampQuantity(5000)).toBe(1000);
  });

  it("adds money without float errors", () => {
    expect(linesTotal([{ price: "0.1", quantity: 1 }, { price: "0.2", quantity: 1 }])).toBe(0.3);
    expect(linesTotal([{ price: "1750", quantity: 2 }, { price: "x", quantity: 4 }])).toBe(3500);
    expect(linesTotal([{ price: "19.99", quantity: 3 }])).toBe(59.97);
  });
});
