import type { Route } from "./+types/robots";
import { siteOrigin } from "~/lib/api.server";

const PRIVATE = ["/api/", "/admin", "/account", "/bag", "/checkout", "/orders/", "/sign-in"];

/** Search engines may read the catalogue; private and staff pages are off limits in both languages. */
export function loader({ context, request }: Route.LoaderArgs) {
  const origin = siteOrigin(context);
  // Anything that is not the real site must not be indexed at all: staging, previews, and also the
  // production Worker when it is reached through its temporary workers.dev address.
  const isProduction = origin === "https://lupinwear.store" && new URL(request.url).hostname === "lupinwear.store";
  const lines = isProduction
    ? [
        "User-agent: *",
        ...PRIVATE.map((path) => `Disallow: ${path}`),
        ...PRIVATE.filter((path) => path !== "/api/" && path !== "/admin").map((path) => `Disallow: /ar${path}`),
        "",
        `Sitemap: ${origin}/sitemap.xml`,
      ]
    : ["User-agent: *", "Disallow: /"];
  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
