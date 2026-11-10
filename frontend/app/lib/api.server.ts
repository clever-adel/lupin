import type { AppLoadContext } from "react-router";
import { EDGE_KEY_HEADER, edgeKey } from "./edge";

/**
 * Server-side data access for loaders. Runs in the Worker and calls the backend directly.
 * Public catalog data only, so no cookies are forwarded and responses may be cached by the caller.
 */
export async function apiGet<T>(context: AppLoadContext, path: string): Promise<T> {
  const origin = context.cloudflare.env.API_ORIGIN;
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = edgeKey(context.cloudflare.env);
  if (key) headers[EDGE_KEY_HEADER] = key;
  let response: Response;
  try {
    response = await fetch(new URL(path, origin), { headers });
  } catch {
    throw new Response("The store is not reachable right now.", { status: 503 });
  }
  if (response.status === 404) {
    throw new Response("Not found", { status: 404 });
  }
  if (!response.ok) {
    throw new Response("The store is not reachable right now.", { status: 502 });
  }
  return (await response.json()) as T;
}

export function siteOrigin(context: AppLoadContext): string {
  return context.cloudflare.env.SITE_ORIGIN.replace(/\/$/, "");
}
