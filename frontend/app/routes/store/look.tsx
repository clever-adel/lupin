import type { CSSProperties } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/look";
import { LookTile, ShopTheLook } from "~/components/look";
import { ProductGrid } from "~/components/product";
import { apiGet } from "~/lib/api.server";
import { pick, toLang, translate, useT } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";
import type { LookDetail } from "~/lib/types";

export async function loader({ params, context }: Route.LoaderArgs) {
  const look = await apiGet<LookDetail>(context, `/api/v1/catalog/looks/${encodeURIComponent(params.slug)}`);
  return { look };
}

export function meta({ params, matches, location, data }: Route.MetaArgs) {
  const lang = toLang(params.lang);
  if (!data) return [{ title: "LUPIN." }];
  const { look } = data;
  const origin = layoutOrigin(matches);
  const title = pick(lang, look, "title");
  const names = look.items.map((i) => pick(lang, i, "name")).join(", ");
  const description = (pick(lang, look, "description") || `${translate(lang, "look.label")}: ${names}`).slice(0, 160);
  const image = look.imageUrl.startsWith("/") ? origin + look.imageUrl : look.imageUrl;
  return [
    ...seo({ origin, pathname: location.pathname, title, description, image }),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: title,
        itemListElement: look.items.map((item, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: origin + (lang === "ar" ? "/ar" : "") + `/product/${item.productSlug}`,
          name: pick(lang, item, "name"),
        })),
      },
    },
  ];
}

export default function LookPage({ loaderData }: Route.ComponentProps) {
  const { t, href } = useT();
  const { look } = loaderData;
  return (
    <div className="shell pt-6">
      <nav aria-label="Breadcrumb" className="text-xs text-stone">
        <ol className="flex flex-wrap gap-x-2">
          <li>
            <Link to={href("/")} className="hover:text-ink">{t("product.home")}</Link> <span aria-hidden="true">/</span>
          </li>
          <li>
            <Link to={href("/looks")} className="hover:text-ink">{t("look.all")}</Link> <span aria-hidden="true">/</span>
          </li>
        </ol>
      </nav>

      <div className="mt-5">
        {/* Keyed by slug so sizes and colours start fresh on every look. */}
        <ShopTheLook key={look.slug} look={look} looks={look.otherLooks} headingLevel="h1" />
      </div>

      {look.pairsWith.length > 0 && (
        <section className="pt-20" aria-labelledby="pairs-title">
          <div data-reveal className="mb-8">
            <p className="label flex items-center gap-3 text-stone">
              <span aria-hidden="true" className="h-px w-8 bg-gold" />
              {t("look.label")}
            </p>
            <h2 id="pairs-title" className="display mt-2 text-2xl md:text-3xl">{t("look.pairsWith")}</h2>
          </div>
          <ProductGrid products={look.pairsWith} />
        </section>
      )}

      {look.otherLooks.length > 0 && (
        <section className="pt-20" aria-labelledby="other-looks-title">
          <div data-reveal className="mb-8 flex items-end justify-between gap-4">
            <h2 id="other-looks-title" className="display text-2xl md:text-3xl">{t("look.otherLooks")}</h2>
            <Link to={href("/looks")} className="btn btn-outline">{t("look.all")}</Link>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-3">
            {look.otherLooks.slice(0, 3).map((l, i) => (
              <li key={l.slug} data-reveal style={{ "--reveal-delay": `${i * 90}ms` } as CSSProperties}>
                <LookTile look={l} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
