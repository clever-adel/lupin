import { describe, expect, it } from "vitest";
import { cmToInches, internationalTable, sizeGroups, STANDARD_CHARTS, standardRows } from "./size-chart";

describe("size chart", () => {
  it("converts cm cells to inches to the nearest quarter", () => {
    expect(cmToInches("75-78")).toBe("29½-30¾");
    expect(cmToInches("82–90")).toBe("32¼-35½");
    expect(cmToInches("90")).toBe("35½");
    expect(cmToInches("97,5")).toBe("38½");
  });

  it("leaves cells that are not numbers alone", () => {
    expect(cmToInches("one size")).toBe("one size");
    expect(cmToInches("")).toBe("");
  });

  it("keeps up to four sizes in one table and splits more into balanced tabs", () => {
    expect(sizeGroups(["S", "M", "L"])).toHaveLength(1);
    expect(sizeGroups(["XXS", "XS", "S", "M", "L", "XL"]).map((g) => g.label)).toEqual(["XXS-S", "M-XL"]);
    expect(sizeGroups(["XS", "S", "M", "L", "XL"]).map((g) => g.sizes.length)).toEqual([3, 2]);
  });

  it("fills a standard chart only for the sizes the product is sold in", () => {
    const rows = standardRows("WOMEN_TOPS", ["S", "M", "L"]);
    expect(rows[0]).toEqual({ labelEn: "Bust", labelAr: "الصدر", values: { S: "80-86.5", M: "86.5-94", L: "94-104" } });
    expect(rows[1]?.values).toEqual({ S: "65-71", M: "71-79", L: "79-91.5" });
  });

  it("fills the men's chart with chest, waist, arm length and neck, 3XL also as XXXL", () => {
    const rows = standardRows("MEN_TOPS", ["S", "M", "XXXL"]);
    expect(rows.map((r) => r.labelEn)).toEqual(["Chest", "Waist", "Arm length", "Neck"]);
    expect(rows[0]?.values).toEqual({ S: "86-90", M: "94-98", XXXL: "126-130" });
    expect(rows[3]?.values).toEqual({ S: "36", M: "38", XXXL: "46" });
  });

  it("fills the Bershka men's hoodie chart for the product's sizes", () => {
    const rows = standardRows("BERSHKA_MEN_HOODIES", ["XS", "S", "M", "L"]);
    expect(rows.map((r) => r.labelEn)).toEqual(["Chest", "Waist", "Neck"]);
    expect(rows[0]?.values).toEqual({ XS: "78-86", S: "86-94", M: "94-102", L: "102-110" });
  });

  it("fills the LC Waikiki jacket chart as piece measurements, 2XL filed as XXL", () => {
    expect(STANDARD_CHARTS.LCW_MEN_JACKETS.kind).toBe("GARMENT");
    const rows = standardRows("LCW_MEN_JACKETS", ["S", "M", "XXL"]);
    expect(rows.map((r) => r.labelEn)).toEqual(["Back width", "Chest width", "Sleeve length"]);
    expect(rows[1]?.values).toEqual({ S: "116", M: "122", XXL: "142" });
  });

  it("lists the international rows for the product's sizes, two UK sizes per women's letter size", () => {
    expect(internationalTable("women", ["S", "M"])?.rows.map((r) => r.values[0])).toEqual([8, 10, 12, 14]);
  });

  it("has a men's conversion and none for other departments", () => {
    const men = internationalTable("men", ["S", "M", "L"]);
    expect(men?.columns).toEqual(["UK", "EUR"]);
    expect(men?.rows.map((r) => r.values[1])).toEqual(["44-46", "48-50", "52-54"]);
    expect(internationalTable("kids", ["S"])).toBeNull();
    expect(internationalTable("men", ["One size"])).toBeNull();
  });
});
