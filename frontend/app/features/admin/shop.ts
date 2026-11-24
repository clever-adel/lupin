// Number entry at the shop counter. Staff type on phones whose keyboard may give Arabic-Indic (٠-٩) or
// Persian (۰-۹) digits and an Arabic decimal comma; the server takes plain digits with at most 2 decimals.

const ARABIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

/** Latin digits, "." as the decimal mark, no spaces or thousands separators. */
export function normalizeNumber(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0)!;
    if (code >= ARABIC_ZERO && code <= ARABIC_ZERO + 9) out += String(code - ARABIC_ZERO);
    else if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) out += String(code - PERSIAN_ZERO);
    else if (ch === "٫" || ch === ",") out += ".";
    else if (ch === "٬" || /\s/.test(ch)) continue;
    else out += ch;
  }
  return out;
}

/** A price staff may save: 0 or more, at most 2 decimals, below a million. */
export function priceOk(value: string): boolean {
  return /^\d{1,7}(\.\d{0,2})?$/.test(value) && Number(value) < 1_000_000;
}

/** A whole number of pieces between 1 and max (and never above 1000, the server's limit). */
export function clampQuantity(value: number, max?: number): number {
  const top = Math.min(max ?? 1000, 1000);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(Math.trunc(value), Math.max(top, 1)));
}

/** Line totals added in piastres, so 0.1 + 0.2 style float errors never reach the screen. */
export function linesTotal(lines: { price: string; quantity: number }[]): number {
  const piastres = lines.reduce(
    (sum, l) => sum + (priceOk(l.price) ? Math.round(Number(l.price) * 100) * l.quantity : 0),
    0,
  );
  return piastres / 100;
}
