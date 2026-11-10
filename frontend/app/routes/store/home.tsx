import { Link, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { loader as layoutLoader } from "./layout";
import { ProductGrid, ProductPhoto } from "~/components/product";
import { apiGet } from "~/lib/api.server";
import { toLang, translate, useT } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";
import type { Page, ProductCard } from "~/lib/types";

export async function loader({ context }: Route.LoaderArgs) {
  const collection = await apiGet<Page<ProductCard>>(context, "/api/v1/catalog/products?pageSize=8&sort=featured");
  return { collection };
}

export function meta({ params, matches, location }: Route.MetaArgs) {
  const lang = toLang(params.lang);
  return seo({
    origin: layoutOrigin(matches),
    pathname: location.pathname,
    title: "LUPIN.",
    description: `LUPIN. ${translate(lang, "brand.slogan")} ${translate(lang, "brand.supporting")}`,
  });
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { t, href, pick } = useT();
  const layout = useRouteLoaderData<typeof layoutLoader>("routes/store/layout");
  const departments = layout?.departments ?? [];
  const campaign = layout?.site.hero;
  const products = loaderData.collection.items;
  const hero = products[0];

  return (
    <>
      {/* Hero: the owner's campaign copy from the dashboard, or the brand lines while there is none. */}
      <section className="bg-ink text-bone">
        <div className="shell grid items-center gap-10 py-14 md:grid-cols-2 md:py-20">
          <div>
            {campaign && pick(campaign, "label") && <p className="label mb-4 text-bone/60">{pick(campaign, "label")}</p>}
            <h1 className="display text-4xl md:text-6xl">{(campaign && pick(campaign, "headline")) || t("brand.slogan")}</h1>
            {campaign && pick(campaign, "text") ? (
              <p className="mt-5 max-w-md text-bone/75">{pick(campaign, "text")}</p>
            ) : (
              <p className="label mt-5 text-bone/60">{t("brand.supporting")}</p>
            )}
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to={href("/shop")} className="btn btn-light">
                {t("home.heroCta")}
              </Link>
            </div>
          </div>
          {hero && (
            <Link to={href(`/product/${hero.slug}`)} className="block md:justify-self-end">
              <ProductPhoto
                url={hero.colors[0]?.imageUrl}
                alt={pick(hero, "name")}
                sizes="(min-width: 768px) 40vw, 90vw"
                eager
                className="aspect-[4/5] w-full md:w-[26rem]"
              />
            </Link>
          )}
        </div>
      </section>

      <section className="shell pt-14" aria-labelledby="departments-title">
        <h2 id="departments-title" className="sr-only">
          {t("home.departments")}
        </h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {departments.map((d) => {
            const name = pick(d, "name");
            const live = d.status === "ACTIVE";
            const body = (
              <div className="relative flex aspect-[3/2] flex-col justify-end overflow-hidden bg-ink p-5 text-bone">
                <span
                  aria-hidden="true"
                  className="display pointer-events-none absolute -top-2 start-3 text-6xl text-transparent opacity-40 [-webkit-text-stroke:1px_var(--color-bone)]"
                >
                  {name}
                </span>
                <span className="display text-lg">{name}</span>
                <span className="mt-1 flex items-center justify-between text-xs text-bone/70">
                  <span>{live ? t("home.styles", { count: d.productCount }) : t("home.comingSoon")}</span>
                  <span className="label border-b border-bone/60 pb-0.5 text-bone">
                    {live ? t("home.shop", { name }) : t("home.comingSoon")}
                  </span>
                </span>
              </div>
            );
            return (
              <li key={d.slug}>
                {live ? (
                  <Link to={href(`/shop/${d.slug}`)} className="block">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="shell pt-16" aria-labelledby="collection-title">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="label text-stone">{t("home.newIn")}</p>
            <h2 id="collection-title" className="display mt-2 text-2xl md:text-3xl">
              {t("home.collection")}
            </h2>
          </div>
          {products.length > 0 && (
            <Link to={href("/shop")} className="btn btn-outline">
              {t("home.viewAll")}
            </Link>
          )}
        </div>
        {products.length > 0 ? <ProductGrid products={products} /> : <p className="text-stone">{t("home.empty")}</p>}
      </section>
    </>
  );
}
