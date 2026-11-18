/**
 * Meta (Facebook / Instagram) Pixel. Off until the owner pastes a Pixel ID in the dashboard
 * (Settings → Ads tracking). Loaded on the storefront only, never in the dashboard.
 *
 * Purchase is also sent by the server (Conversions API) with the same event id, and Meta keeps one.
 */

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[][]; loaded?: boolean; version?: string };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let started: string | null = null;

/** Meta's loader, written out (no inline script, so the page's script policy stays strict). */
export function startPixel(pixelId: string | null | undefined): boolean {
  if (typeof window === "undefined" || !pixelId || !/^\d{10,20}$/.test(pixelId)) return false;
  if (started === pixelId) return true;
  if (!window.fbq) {
    const fbq: Fbq = (...args: unknown[]) => {
      fbq.queue!.push(args);
    };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = "2.0";
    window.fbq = fbq;
    window._fbq = fbq;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
  window.fbq("init", pixelId);
  started = pixelId;
  return true;
}

export type PixelEvent = "PageView" | "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase";

/** Does nothing while the Pixel is off. */
export function track(event: PixelEvent, params?: Record<string, unknown>, eventId?: string): void {
  if (typeof window === "undefined" || !started || !window.fbq) return;
  if (eventId) window.fbq("track", event, params ?? {}, { eventID: eventId });
  else window.fbq("track", event, params ?? {});
}

/** Purchase once per order in this browser, even if the order page is opened again. */
export function trackPurchaseOnce(reference: string, value: number, items: number): void {
  if (!started) return;
  const key = `lupin.px.${reference}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    /* storage blocked: Meta still drops the repeat by its event id */
  }
  track("Purchase", { currency: "EGP", value, num_items: items }, `purchase-${reference}`);
}
