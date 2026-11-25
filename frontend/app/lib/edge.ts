/**
 * The key this Worker shows the API on every request it makes or forwards. The API refuses anything
 * that arrives without it, so the API cannot be used around the Worker. Set as a Worker secret:
 *   wrangler secret put EDGE_SHARED_SECRET          (same value as the API's LUPIN_EDGE_SECRET)
 * Locally it is unset and the API does not ask for it.
 */
export const EDGE_KEY_HEADER = "X-Lupin-Edge-Key";

/**
 * HTTPS only: the HTTPS address to send a plain-HTTP request to, or null when it may stay as it is
 * (already HTTPS, or a developer's own machine). 308 keeps the method and body.
 */
export function httpsRedirect(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
    || url.hostname.endsWith(".localhost");
  if (url.protocol !== "http:" || local) return null;
  url.protocol = "https:";
  return url.toString();
}

export function edgeKey(env: unknown): string | undefined {
  const value = (env as { EDGE_SHARED_SECRET?: string }).EDGE_SHARED_SECRET;
  return value ? value : undefined;
}
