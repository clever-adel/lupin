import type { SizeGuide } from "./types";

/**
 * "Find my size": estimates the shopper's chest (or bust) from height and weight, then picks the size
 * whose chest range in the product's own body chart holds that estimate. A rough guide, never a promise.
 */

export const HEIGHT_RANGE = { min: 140, max: 210 } as const;
export const WEIGHT_RANGE = { min: 35, max: 200 } as const;

/**
 * Chest girth in cm from height (cm) and weight (kg): a straight-line fit through typical adult
 * measurements (men 170 cm/60 kg ≈ 88, 175/70 ≈ 95, 180/85 ≈ 104, 185/100 ≈ 113; women 160/50 ≈ 81,
 * 165/60 ≈ 88, 170/75 ≈ 98).
 */
export function estimateChest(heightCm: number, weightKg: number, department?: string): number {
  return department === "women" ? 0.6 * weightKg + 0.2 * heightCm + 19 : 0.4 * weightKg + 0.6 * heightCm - 38;
}

function range(value: string | undefined): [number, number] | null {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(?:[-–—]\s*(\d+(?:[.,]\d+)?))?\s*$/.exec(value ?? "");
  if (!match?.[1]) return null;
  const from = Number(match[1].replace(",", "."));
  const to = match[2] ? Number(match[2].replace(",", ".")) : from;
  return [Math.min(from, to), Math.max(from, to)];
}

/** How far (cm) past the largest size's chest range a piece may still be suggested, as "may feel snug". */
export const SNUG_MARGIN = 4;

/**
 * in: the estimate falls in (or between) the product's ranges; below: smaller than the smallest size,
 * so it may feel roomy; above: just past the largest size, so it may feel snug; tooSmall: well past
 * the largest size this piece is sold in, so no size here is suggested.
 */
export type SizeAdvice = { size: string; fit: "in" | "below" | "above" | "tooSmall"; chest: number };

/**
 * The size to suggest, or null when the chart cannot tell (no body chart, no chest row, bad input).
 * Between two ranges it takes the nearer one, and the smaller on a tie, since imported pieces run large.
 */
export function recommendSize(
  guide: SizeGuide | null | undefined,
  sizes: string[],
  heightCm: number,
  weightKg: number,
  department?: string,
): SizeAdvice | null {
  if (!guide || guide.kind !== "BODY") return null;
  if (!(heightCm >= HEIGHT_RANGE.min && heightCm <= HEIGHT_RANGE.max)) return null;
  if (!(weightKg >= WEIGHT_RANGE.min && weightKg <= WEIGHT_RANGE.max)) return null;
  const row = guide.rows.find((r) => /chest|bust/i.test(r.labelEn));
  if (!row) return null;
  const bands = sizes
    .map((size) => ({ size, band: range(row.values[size]) }))
    .filter((b): b is { size: string; band: [number, number] } => b.band !== null)
    .sort((a, b) => a.band[0] - b.band[0]);
  const first = bands[0];
  const last = bands[bands.length - 1];
  if (!first || !last) return null;

  const chest = Math.round(estimateChest(heightCm, weightKg, department));
  if (chest < first.band[0]) return { size: first.size, fit: "below", chest };
  if (chest > last.band[1] + SNUG_MARGIN) return { size: last.size, fit: "tooSmall", chest };
  if (chest > last.band[1]) return { size: last.size, fit: "above", chest };
  const inside = bands.find((b) => chest >= b.band[0] && chest <= b.band[1]);
  if (inside) return { size: inside.size, fit: "in", chest };
  const distance = (b: { band: [number, number] }) => Math.min(Math.abs(chest - b.band[0]), Math.abs(chest - b.band[1]));
  const nearest = bands.reduce((best, b) => (distance(b) < distance(best) ? b : best));
  return { size: nearest.size, fit: "in", chest };
}
