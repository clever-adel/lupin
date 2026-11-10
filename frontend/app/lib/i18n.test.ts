import { describe, expect, it } from "vitest";
import { formatMoney, localePath, pick, switchLangPath, toLang, translate } from "./i18n";

describe("language routing", () => {
  it("treats anything but 'ar' as English", () => {
    expect(toLang("ar")).toBe("ar");
    expect(toLang(undefined)).toBe("en");
    expect(toLang("fr")).toBe("en");
  });

  it("prefixes Arabic paths and leaves English ones alone", () => {
    expect(localePath("en", "/shop/men")).toBe("/shop/men");
    expect(localePath("ar", "/shop/men")).toBe("/ar/shop/men");
    expect(localePath("ar", "/")).toBe("/ar");
    expect(localePath("en", "bag")).toBe("/bag");
  });

  it("switches language while keeping the page and its filters", () => {
    expect(switchLangPath("/", "")).toBe("/ar");
    expect(switchLangPath("/ar", "")).toBe("/");
    expect(switchLangPath("/shop/men", "?sale=true")).toBe("/ar/shop/men?sale=true");
    expect(switchLangPath("/ar/product/x", "")).toBe("/product/x");
    // A path that merely starts with "ar" is not Arabic.
    expect(switchLangPath("/archive", "")).toBe("/ar/archive");
  });
});

describe("text and money", () => {
  it("fills placeholders in both languages", () => {
    expect(translate("en", "shop.styles", { count: 6 })).toBe("6 styles");
    expect(translate("ar", "shop.pageOf", { page: 2, pages: 5 })).toBe("صفحة 2 من 5");
  });

  it("picks the Arabic field and falls back to English when it is empty", () => {
    expect(pick("ar", { nameEn: "Bomber", nameAr: "بومبر" }, "name")).toBe("بومبر");
    expect(pick("ar", { nameEn: "Bomber", nameAr: "" }, "name")).toBe("Bomber");
    expect(pick("en", { nameEn: "Bomber", nameAr: "بومبر" }, "name")).toBe("Bomber");
  });

  it("formats EGP with Latin digits in both languages", () => {
    expect(formatMoney("en", 2750)).toBe("EGP 2,750");
    expect(formatMoney("en", 1999.5)).toBe("EGP 1,999.50");
    expect(formatMoney("ar", 2750)).toBe("2,750 ج.م");
  });
});
