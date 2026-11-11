import { createRequestHandler } from "react-router";
import { EDGE_KEY_HEADER, edgeKey } from "../app/lib/edge";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/**
 * The browser only ever talks to this origin. /api/* is forwarded to the Spring Boot backend so that
 * auth cookies are first-party and production needs no CORS.
 */
async function proxyApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  // Whatever the browser sent for these is discarded: only this Worker may say who the client is.
  headers.delete("Forwarded");
  headers.delete("X-Forwarded-For");
  headers.delete(EDGE_KEY_HEADER);
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("X-Forwarded-For", clientIp);
  const key = edgeKey(env);
  if (key) headers.set(EDGE_KEY_HEADER, key);
  headers.delete("host");

  try {
    return await fetch(new URL(url.pathname + url.search, env.API_ORIGIN), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
  } catch {
    return Response.json(
      { code: "API_UNAVAILABLE", message: "The store is not reachable right now. Please try again." },
      { status: 502 },
    );
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // The Content-Security-Policy is set in app/entry.server.tsx, which knows the per-request script nonce.
};

export default {
  async fetch(request, env, ctx) {
    const { pathname, hostname } = new URL(request.url);
    // One address for the store: www.lupinwear.store permanently redirects to lupinwear.store, so
    // cookies, search engines and shared links all agree on a single origin.
    if (hostname.startsWith("www.")) {
      const target = new URL(request.url);
      target.hostname = hostname.slice(4);
      return Response.redirect(target.toString(), 301);
    }
    if (pathname.startsWith("/api/")) {
      return proxyApi(request, env);
    }
    const response = await requestHandler(request, { cloudflare: { env, ctx } });
    if (!response.headers.get("Content-Type")?.includes("text/html")) {
      return response;
    }
    const secured = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      secured.headers.set(name, value);
    }
    if (new URL(request.url).protocol === "https:") {
      secured.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    return secured;
  },
} satisfies ExportedHandler<Env>;
