/**
 * Edge cache for public store data. Products, departments, looks, reviews and site content are the same
 * for every visitor, so Cloudflare keeps each answer for a short time and serves it to everyone who asks
 * in that time, without reaching the API. A visit rush then costs the API about one request per address
 * every few seconds instead of one per visitor.
 *
 * Never cached: anything with a person in it (bag, orders, account, dashboard), the live prices and stock
 * a bag checks before checkout (/catalog/variants), and any answer that sets a cookie.
 */

/** How long an answer is shared, in seconds. A change in the dashboard reaches every visitor within this. */
export const API_CACHE_SECONDS = 30;

const SHARED = /^\/api\/v1\/(catalog|content)\//;
const ALWAYS_FRESH = /^\/api\/v1\/catalog\/variants(\/|$)/;

/** Sent by the dashboard: staff always read the API itself, so they see their own changes at once. */
export const FRESH_HEADER = "X-Lupin-Fresh";

/** Whether a request to the API may be answered from the shared cache. */
export function isShareable(method: string, pathname: string, headers?: Headers): boolean {
  return method === "GET" && SHARED.test(pathname) && !ALWAYS_FRESH.test(pathname) && !headers?.has(FRESH_HEADER);
}

/** Seconds to share answers for: only on the real site (https); local development always asks the API. */
export function cacheSeconds(siteOrigin: string): number {
  return siteOrigin.startsWith("https://") ? API_CACHE_SECONDS : 0;
}

/** The parts of Cloudflare's runtime this needs, so tests can pass a stand-in. */
export interface EdgeCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

/**
 * Answers from the cache when it holds a fresh copy for `key`; otherwise calls `load` and, when the answer
 * is a success without cookies, keeps a copy for `seconds`. The copy is stored in the background
 * (`waitUntil`) so the visitor never waits for it. Browsers are still told not to keep the answer, so a
 * visitor's own browser never shows data older than the edge's copy.
 */
export async function shared(
  cache: EdgeCache | undefined,
  key: string,
  seconds: number,
  waitUntil: (work: Promise<unknown>) => void,
  load: () => Promise<Response>,
): Promise<Response> {
  if (!cache || seconds <= 0) return load();
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Edge-Cache", "HIT");
    return response;
  }
  const response = await load();
  if (response.status !== 200 || response.headers.has("Set-Cookie")) return response;
  const copy = new Response(response.clone().body, response);
  copy.headers.set("Cache-Control", `public, max-age=${seconds}`);
  waitUntil(cache.put(key, copy).catch(() => undefined));
  return response;
}

/** Cloudflare's cache for this Worker, or undefined where there is none (unit tests, other runtimes). */
export function edgeCache(): EdgeCache | undefined {
  const store = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!store) return undefined;
  return {
    match: (key) => store.match(key),
    put: (key, response) => store.put(key, response),
  };
}
