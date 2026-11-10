/**
 * The key this Worker shows the API on every request it makes or forwards. The API refuses anything
 * that arrives without it, so the API cannot be used around the Worker. Set as a Worker secret:
 *   wrangler secret put EDGE_SHARED_SECRET          (same value as the API's LUPIN_EDGE_SECRET)
 * Locally it is unset and the API does not ask for it.
 */
export const EDGE_KEY_HEADER = "X-Lupin-Edge-Key";

export function edgeKey(env: unknown): string | undefined {
  const value = (env as { EDGE_SHARED_SECRET?: string }).EDGE_SHARED_SECRET;
  return value ? value : undefined;
}
