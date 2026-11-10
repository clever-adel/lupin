import type { Route } from "./+types/sitemap";
import { apiGet, siteOrigin } from "~/lib/api.server";
import type { Department, Page, ProductCard, SiteContent } from "~/lib/types";

const MAX_PRODUCT_PAGES = 40; // 48 per page: up to 1,920 products in one sitemap file

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Public, indexable pages only, each listed in English and Arabic with hreflang alternates. */
export async function loader({ context }: Route.LoaderArgs) {
  const origin = siteOrigin(context);
  const [departments, site] = await Promise.all([
    apiGet<Department[]>(context, "/api/v1/catalog/departments"),
    apiGet<SiteContent>(context, "/api/v1/content/site"),
  ]);

  const paths = ["/", "/shop", "/faq"];
  departments.filter((d) => d.status === "ACTIVE").forEach((d) => paths.push(`/shop/${d.slug}`));
  site.policies.forEach((p) => paths.push(`/policies/${p.slug}`));
  for (let page = 0; page < MAX_PRODUCT_PAGES; page++) {
    const products = await apiGet<Page<ProductCard>>(context, `/api/v1/catalog/products?pageSize=48&sort=newest&page=${page}`);
    products.items.forEach((p) => paths.push(`/product/${p.slug}`));
    if (page + 1 >= products.totalPages) break;
  }

  const entries = paths.flatMap((path) => {
    const english = escapeXml(origin + path);
    const arabic = escapeXml(origin + (path === "/" ? "/ar" : `/ar${path}`));
    const alternates =
      `<xhtml:link rel="alternate" hreflang="en" href="${english}"/>` +
      `<xhtml:link rel="alternate" hreflang="ar" href="${arabic}"/>` +
      `<xhtml:link rel="alternate" hreflang="x-default" href="${english}"/>`;
    return [`<url><loc>${english}</loc>${alternates}</url>`, `<url><loc>${arabic}</loc>${alternates}</url>`];
  });

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    entries.join("\n") +
    "\n</urlset>\n";
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
