import type { SizeGuideRow } from "./types";

/**
 * Pure helpers behind the size chart: cm → inch, splitting many sizes into tabs, the standard
 * body charts the admin can start from, and the women's international size conversion.
 */

const FRACTIONS: Record<number, string> = { 0: "", 0.25: "¼", 0.5: "½", 0.75: "¾" };

/** 75 → "29½": centimetres to inches, to the nearest quarter. */
function inches(cm: number): string {
  const quarters = Math.round((cm / 2.54) * 4) / 4;
  const whole = Math.floor(quarters);
  const fraction = FRACTIONS[quarters - whole] ?? "";
  return whole === 0 && fraction ? fraction : `${whole}${fraction}`;
}

/**
 * Converts a chart cell written in cm ("80", "80-86.5", "80–86.5") to inches ("31½", "31½-34").
 * Anything that is not a plain number or range is returned as it was.
 */
export function cmToInches(value: string): string {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(?:[-–—]\s*(\d+(?:[.,]\d+)?))?\s*$/.exec(value);
  if (!match) return value;
  const from = Number((match[1] ?? "").replace(",", "."));
  if (match[2] === undefined) return inches(from);
  return `${inches(from)}-${inches(Number(match[2].replace(",", ".")))}`;
}

/** Up to four sizes fit in one table; more are split into balanced tabs of about three. */
export function sizeGroups(sizes: string[]): { label: string; sizes: string[] }[] {
  if (sizes.length <= 4) return [{ label: sizes.join(" · "), sizes }];
  const count = Math.ceil(sizes.length / 3);
  const groups: { label: string; sizes: string[] }[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const size = Math.ceil((sizes.length - start) / (count - i));
    const part = sizes.slice(start, start + size);
    groups.push({ label: part.length > 1 ? `${part[0]}-${part[part.length - 1]}` : (part[0] ?? ""), sizes: part });
    start += size;
  }
  return groups;
}

type Standard = { labelEn: string; labelAr: string; values: Record<string, string> }[];

const MEN_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"] as const;

/** One value per men's size, XXS to 3XL; 3XL is also filed as XXXL, the other way it is written. */
function men(values: [string][]): Record<string, string> {
  const out: Record<string, string> = {};
  MEN_SIZES.forEach((size, i) => {
    const value = values[i]?.[0];
    if (value) out[size] = value;
  });
  if (out["3XL"]) out["XXXL"] = out["3XL"];
  return out;
}

/** Standard body measurements in cm, by size, that a product's chart can start from. */
export const STANDARD_CHARTS: Record<"WOMEN_TOPS" | "MEN_TOPS" | "BERSHKA_MEN_HOODIES", { title: string; rows: Standard }> = {
  WOMEN_TOPS: {
    title: "Women's tops & T-shirts",
    rows: [
      { labelEn: "Bust", labelAr: "الصدر", values: { XS: "73.5-80", S: "80-86.5", M: "86.5-94", L: "94-104", XL: "104-114" } },
      { labelEn: "Waist", labelAr: "الوسط", values: { XS: "60-65", S: "65-71", M: "71-79", L: "79-91.5", XL: "91.5-103" } },
    ],
  },
  MEN_TOPS: {
    title: "Men's tops, sweatshirts & T-shirts",
    rows: [
      { labelEn: "Chest", labelAr: "الصدر", values: men([["74-78"], ["78-86"], ["86-90"], ["94-98"], ["102-106"], ["110-114"], ["118-122"], ["126-130"]]) },
      { labelEn: "Waist", labelAr: "الوسط", values: men([["62-66"], ["66-74"], ["74-78"], ["82-86"], ["90-94"], ["98.5-103"], ["107.5-112"], ["116.5-121"]]) },
      { labelEn: "Arm length", labelAr: "طول الذراع", values: men([["59"], ["59"], ["59-60"], ["60-61"], ["61-62"], ["62-62.5"], ["62.5-63"], ["63"]]) },
      { labelEn: "Neck", labelAr: "الرقبة", values: men([["33"], ["34-35"], ["36"], ["38"], ["40"], ["42"], ["44"], ["46"]]) },
    ],
  },
  // Bershka men's sweat tops: chest bands as Bershka publishes them (XS 78-86 … XXL 118-126); waist and
  // neck from the matching Inditex men's chart, whose chest bands are the same.
  BERSHKA_MEN_HOODIES: {
    title: "Bershka men's hoodies & sweatshirts",
    rows: [
      { labelEn: "Chest", labelAr: "الصدر", values: { XS: "78-86", S: "86-94", M: "94-102", L: "102-110", XL: "110-118", XXL: "118-126" } },
      { labelEn: "Waist", labelAr: "الوسط", values: { XS: "66-74", S: "74-82", M: "82-90", L: "90-98.5", XL: "98.5-107.5", XXL: "107.5-116.5" } },
      { labelEn: "Neck", labelAr: "الرقبة", values: { XS: "34-35", S: "36-37", M: "38-39", L: "40-41", XL: "42-43", XXL: "44-45" } },
    ],
  },
};

/** A standard chart's rows, keeping only the sizes this product is sold in. */
export function standardRows(key: keyof typeof STANDARD_CHARTS, sizes: string[]): SizeGuideRow[] {
  return STANDARD_CHARTS[key].rows.map((row) => ({
    labelEn: row.labelEn,
    labelAr: row.labelAr,
    values: Object.fromEntries(sizes.flatMap((s) => (row.values[s] ? [[s, row.values[s]] as const] : []))),
  }));
}

type Conversion = { columns: readonly string[]; rows: { size: string; values: (number | string)[] }[] };

/** Letter sizes against national sizes, per department. Women's S, M, L, XL and XXL each cover two UK sizes. */
export const INTERNATIONAL: Record<"women" | "men", Conversion> = {
  women: {
    columns: ["UK", "EU", "US", "AU", "JP", "FR", "IT", "UA/KZ"],
    rows: [
      { size: "XS", values: [6, 34, 2, 6, 5, 36, 38, 40] },
      { size: "S", values: [8, 36, 4, 8, 7, 38, 40, 42] },
      { size: "S", values: [10, 38, 6, 10, 9, 40, 42, 44] },
      { size: "M", values: [12, 40, 8, 12, 11, 42, 44, 46] },
      { size: "M", values: [14, 42, 10, 14, 13, 44, 46, 48] },
      { size: "L", values: [16, 44, 12, 16, 15, 46, 48, 50] },
      { size: "L", values: [18, 46, 14, 18, 17, 48, 50, 52] },
      { size: "XL", values: [20, 48, 16, 20, 19, 50, 52, 54] },
      { size: "XL", values: [22, 50, 18, 22, 21, 52, 54, 56] },
      { size: "XXL", values: [24, 52, 20, 24, 23, 54, 56, 58] },
      { size: "XXL", values: [26, 54, 22, 26, 25, 56, 58, 60] },
      { size: "XXXL", values: [28, 56, 24, 28, 27, 58, 60, 62] },
    ],
  },
  // Men's tops: UK is the jacket size (R = regular length), EUR the European size.
  men: {
    columns: ["UK", "EUR"],
    rows: [
      { size: "XXS", values: ["28", "38"] },
      { size: "XS", values: ["30R-32R", "40-42"] },
      { size: "S", values: ["34R-36R", "44-46"] },
      { size: "M", values: ["38R-40R", "48-50"] },
      { size: "L", values: ["42R-44R", "52-54"] },
      { size: "XL", values: ["46R-48R", "56-58"] },
      { size: "XXL", values: ["50R-52R", "60-62"] },
      { size: "3XL", values: ["54R-56R", "64-66"] },
      { size: "XXXL", values: ["54R-56R", "64-66"] },
    ],
  },
};

/** The conversion table for a department, with only the sizes this product is sold in; null when there is none. */
export function internationalTable(department: string | undefined, sizes: string[]): Conversion | null {
  const table = department === "women" || department === "men" ? INTERNATIONAL[department] : null;
  if (!table) return null;
  const rows = table.rows.filter((row) => sizes.includes(row.size));
  return rows.length ? { columns: table.columns, rows } : null;
}
