import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { NonceContext } from "./lib/nonce";

/**
 * Only scripts carrying this request's random nonce may run, so injected markup cannot execute code.
 * Styles still allow inline (React style attributes). Scripts, styles and fonts all come from this origin.
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: https://res.cloudinary.com",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

// Streaming server render for the Workers runtime (no Node streams).
export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  let shellRendered = false;
  let status = responseStatusCode;
  const random = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...random));

  const body = await renderToReadableStream(
    <NonceContext.Provider value={nonce}>
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
    </NonceContext.Provider>,
    {
      nonce,
      signal: request.signal,
      onError(error: unknown) {
        status = 500;
        // Errors before the shell is ready reject the promise above and are handled by the router.
        if (shellRendered) console.error(error);
      },
    },
  );
  shellRendered = true;

  // Crawlers and single-page-mode get the complete document rather than a stream.
  if (isbot(request.headers.get("user-agent") ?? "") || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  // Vite's dev client needs websockets and eval, so the policy is enforced on built output only.
  if (!import.meta.env.DEV) {
    responseHeaders.set("Content-Security-Policy", contentSecurityPolicy(nonce));
  }
  return new Response(body, { headers: responseHeaders, status });
}
