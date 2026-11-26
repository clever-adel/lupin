import type { SiteContent } from "./types";

/** An Egyptian mobile (01xxxxxxxxx, +201…, 00201…) as wa.me wants it: digits with the country code. */
export function whatsappDigits(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^01[0125]\d{8}$/.test(digits)) digits = "2" + digits;
  return /^201[0125]\d{8}$/.test(digits) ? digits : null;
}

/**
 * A chat with the store on WhatsApp, with `text` typed in. Uses the WhatsApp number from the dashboard,
 * or the contact phone when none is set; null when neither is an Egyptian mobile.
 */
export function whatsappLink(site: SiteContent | undefined, text: string): string | null {
  const digits = whatsappDigits(site?.contact.whatsappNumber || site?.contact.phone || "");
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}
