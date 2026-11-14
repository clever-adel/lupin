import { Fragment, type CSSProperties } from "react";
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
  const headline = (campaign && pick(campaign, "headline")) || t("brand.slogan");

  return (
    <>
      {/* Hero: the owner's campaign copy from the dashboard, or the brand lines while there is none. */}
      {/* Direction B: the page takes the photos' studio grey, so the model stands in the page itself. */}
      <section className="relative overflow-hidden bg-studio text-ink">
        <p
          aria-hidden="true"
          className="hero-backdrop display pointer-events-none absolute max-md:hidden inset-x-0 bottom-[3%] select-none whitespace-nowrap text-center text-[11vw] leading-none text-ink/[0.05]"
        >
          {t("brand.slogan")}
        </p>
        <div className="shell relative grid items-center gap-8 py-10 md:grid-cols-[1fr_minmax(0,24rem)_1fr] md:gap-10 md:py-16">
          <div>
            {campaign && pick(campaign, "label") && (
              <p data-reveal className="label mb-4 text-stone">
                {pick(campaign, "label")}
              </p>
            )}
            <h1 className="display text-4xl md:text-5xl">
              {headline.split(" ").map((word, i) => (
                <Fragment key={i}>
                  {i > 0 && " "}
                  <span className="hero-word" style={{ "--i": i } as CSSProperties}>
                    {word}
                  </span>
                </Fragment>
              ))}
            </h1>
            {campaign && pick(campaign, "text") && (
              <p data-reveal className="mt-5 max-w-xs text-stone" style={{ "--reveal-delay": "900ms" } as CSSProperties}>
                {pick(campaign, "text")}
              </p>
            )}
          </div>
          {hero && (
            <Link
              to={href(`/product/${hero.slug}`)}
              data-reveal="photo"
              style={{ "--reveal-delay": "150ms" } as CSSProperties}
              className="block overflow-hidden"
            >
              <ProductPhoto
                url={hero.colors[0]?.imageUrl}
                alt={pick(hero, "name")}
                sizes="(min-width: 768px) 24rem, 90vw"
                eager
                className="aspect-[4/5] w-full"
              />
            </Link>
          )}
          <div data-reveal className="md:text-end" style={{ "--reveal-delay": "1100ms" } as CSSProperties}>
            <p className="label text-stone">{t("brand.supporting")}</p>
            <Link to={href("/shop")} className="btn btn-outline mt-5">
              {t("home.heroCta")}
            </Link>
          </div>
        </div>
      </section>

      <section className="shell pt-14" aria-labelledby="departments-title">
        <h2 id="departments-title" className="sr-only">
          {t("home.departments")}
        </h2>
        {/* As many columns as visible departments, so hiding some never leaves empty space. */}
        <ul
          className="grid gap-3 md:grid-cols-[repeat(var(--n),minmax(0,1fr))]"
          style={{ "--n": Math.max(departments.length, 1) } as CSSProperties}
        >
          {departments.map((d, i) => {
            const name = pick(d, "name");
            const live = d.status === "ACTIVE";
            const body = (
              <div className="relative flex aspect-[3/2] flex-col justify-end md:aspect-auto md:h-64 overflow-hidden bg-ink p-5 text-bone">
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
              <li key={d.slug} data-reveal style={{ "--reveal-delay": `${i * 110}ms` } as CSSProperties}>
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
        <div data-reveal className="mb-8 flex items-end justify-between gap-4">
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
