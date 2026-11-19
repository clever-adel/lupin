import type { Route } from "./+types/catalog-meta";
import { apiGet, siteOrigin } from "~/lib/api.server";
import type { Page, ProductCard, ProductDetail } from "~/lib/types";

const MAX_PRODUCT_PAGES = 40; // 48 per page

/** A CSV field: quoted, with quotes doubled and line breaks flattened. */
function field(value: string | number | undefined): string {
  return `"${String(value ?? "").replace(/[\r\n]+/g, " ").replace(/"/g, '""')}"`;
}

const egp = (amount: number) => `${amount.toFixed(2)} EGP`;

const GENDER: Record<string, string> = { men: "male", women: "female" };

/**
 * Product feed for Meta Commerce Manager (Facebook and Instagram shops, catalogue ads).
 * One row per product, with the product's id: the same id the Meta Pixel and the Conversions API
 * send as content_ids, so views, adds to bag and purchases match catalogue items.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const origin = siteOrigin(context);
  const slugs: string[] = [];
  for (let page = 0; page < MAX_PRODUCT_PAGES; page++) {
    const products = await apiGet<Page<ProductCard>>(context, `/api/v1/catalog/products?pageSize=48&sort=newest&page=${page}`);
    products.items.forEach((p) => slugs.push(p.slug));
    if (page + 1 >= products.totalPages) break;
  }
  const details: ProductDetail[] = [];
  for (let i = 0; i < slugs.length; i += 8) {
    const batch = await Promise.all(
      slugs.slice(i, i + 8).map((slug) => apiGet<ProductDetail>(context, `/api/v1/catalog/products/${encodeURIComponent(slug)}`).catch(() => null)),
    );
    batch.forEach((p) => p && details.push(p));
  }

  const absolute = (url: string) => (url.startsWith("/") ? origin + url : url);
  const header = [
    "id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link",
    "additional_image_link", "brand", "color", "size", "gender", "age_group", "product_type", "item_group_id",
  ];
  const rows = details.flatMap((p) => {
    const main = p.colors.find((c) => c.main) ?? p.colors[0];
    const images = p.colors.flatMap((c) => c.images.map((img) => absolute(img.url)));
    const mainUrl = main?.images[0]?.url;
    const cover = mainUrl ? absolute(mainUrl) : images[0];
    if (!main || !cover) return []; // Meta refuses items without a photo
    const sizes = [...new Set(p.colors.flatMap((c) => c.variants.map((v) => v.sizeCode)))];
    const inStock = p.colors.some((c) => c.variants.some((v) => v.available));
    const description = [p.descriptionEn, p.fitEn && `Fit: ${p.fitEn}.`, p.fabricEn && `Fabric: ${p.fabricEn}`]
      .filter(Boolean).join(" ").trim() || p.nameEn;
    const onSale = p.salePrice !== undefined && p.salePrice !== null && p.salePrice < p.price;
    return [[
      p.id,
      p.nameEn,
      description,
      inStock ? "in stock" : "out of stock",
      "new",
      egp(p.price),
      onSale ? egp(p.salePrice as number) : "",
      `${origin}/product/${p.slug}`,
      cover,
      images.filter((url) => url !== cover).slice(0, 10).join(","),
      p.brand || "LUPIN.",
      p.colors.map((c) => c.nameEn).join("/"),
      sizes.join(","),
      GENDER[p.department.slug] ?? "unisex",
      p.department.slug === "kids" ? "kids" : "adult",
      `${p.department.nameEn} > ${p.category.nameEn}`,
      p.id,
    ].map(field).join(",")];
  });

  const csv = [header.join(","), ...rows].join("\n") + "\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Robots-Tag": "noindex",
    },
  });
}
