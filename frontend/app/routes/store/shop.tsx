import { Form, Link, useSubmit } from "react-router";
import type { Route } from "./+types/shop";
import { ProductGrid } from "~/components/product";
import { apiGet } from "~/lib/api.server";
import { pick, toLang, translate, useT } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";
import type { Department, Facets, Page, ProductCard } from "~/lib/types";

const SORTS = ["featured", "newest", "price_asc", "price_desc"] as const;
/** Query parameters the shop understands. Anything else in the URL is ignored. */
const SINGLE = ["category", "q", "minPrice", "maxPrice", "sort"] as const;
const MULTI = ["size", "color"] as const;
const FLAGS = ["sale", "inStock"] as const;

function cleanParams(url: URL): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of SINGLE) {
    const value = url.searchParams.get(key)?.trim();
    if (value) out.set(key, value.slice(0, 80));
  }
  for (const key of MULTI) {
    for (const value of url.searchParams.getAll(key)) {
      if (value) out.append(key, value.slice(0, 40));
    }
  }
  for (const key of FLAGS) {
    if (url.searchParams.get(key) === "true") out.set(key, "true");
  }
  const page = Number(url.searchParams.get("page"));
  if (Number.isInteger(page) && page > 1) out.set("page", String(page));
  return out;
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const departments = await apiGet<Department[]>(context, "/api/v1/catalog/departments");
  const department = params.department ? departments.find((d) => d.slug === params.department) : undefined;
  if (params.department && !department) {
    throw new Response("Not found", { status: 404 });
  }
  const query = cleanParams(new URL(request.url));
  if (department && department.status !== "ACTIVE") {
    return { department, departments, query: query.toString(), products: null, facets: null };
  }

  const api = new URLSearchParams(query);
  const page = Number(api.get("page") ?? "1");
  api.set("page", String(page - 1));
  api.set("pageSize", "24");
  if (department) api.set("department", department.slug);
  const scope = department ? `?department=${encodeURIComponent(department.slug)}` : "";
  const [products, facets] = await Promise.all([
    apiGet<Page<ProductCard>>(context, `/api/v1/catalog/products?${api}`),
    apiGet<Facets>(context, `/api/v1/catalog/facets${scope}`),
  ]);
  return { department, departments, query: query.toString(), products, facets };
}

export function meta({ params, matches, location, data }: Route.MetaArgs) {
  const lang = toLang(params.lang);
  const name = data?.department ? pick(lang, data.department, "name") : translate(lang, "shop.label");
  return seo({
    origin: layoutOrigin(matches),
    pathname: location.pathname,
    title: name,
    description: `${name} — LUPIN. ${translate(lang, "brand.slogan")}`,
    // Filtered and paginated views are not separate pages for search engines.
    noindex: location.search.length > 1,
  });
}

export default function Shop({ loaderData }: Route.ComponentProps) {
  const { t, href, pick: p } = useT();
  const submit = useSubmit();
  const { department, departments, products, facets } = loaderData;
  const query = new URLSearchParams(loaderData.query);
  const base = href(department ? `/shop/${department.slug}` : "/shop");
  const title = department ? p(department, "name") : t("shop.label");
  const categories = (department ? [department] : departments.filter((d) => d.status === "ACTIVE"))
    .flatMap((d) => d.categories)
    .filter((c) => !c.parentSlug);
  const activeCategory = query.get("category");
  const hasFilters = [...query.keys()].some((k) => k !== "sort" && k !== "category" && k !== "page");

  const withParams = (change: Record<string, string | null>) => {
    const next = new URLSearchParams(query);
    next.delete("page");
    for (const [key, value] of Object.entries(change)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const text = next.toString();
    return text ? `${base}?${text}` : base;
  };
  const pill = (active: boolean) =>
    `shrink-0 rounded-full border px-4 py-2 text-sm ${active ? "border-ink bg-ink text-bone" : "border-line bg-card hover:border-ink"}`;

  return (
    <div className="shell pt-10">
      <p className="label text-stone">{t("shop.label")}</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="display text-3xl md:text-4xl">{title}</h1>
        <ul className="flex gap-1.5">
          {departments.map((d) => (
            <li key={d.slug}>
              <Link
                to={href(`/shop/${d.slug}`)}
                aria-current={d.slug === department?.slug ? "page" : undefined}
                className={`label block border px-4 py-2.5 ${d.slug === department?.slug ? "border-ink bg-ink text-bone" : "border-line bg-card hover:border-ink"}`}
              >
                {p(d, "name")}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {products === null || facets === null ? (
        <div className="mt-16 border-y border-line py-20 text-center">
          <h2 className="display text-2xl">{t("shop.soonTitle", { name: title })}</h2>
          <p className="mt-3 text-stone">{t("shop.soonText")}</p>
        </div>
      ) : (
        <>
          <div className="mt-6 border-y border-line py-4">
            {categories.length > 0 && (
              <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-3">
                <li>
                  <Link to={withParams({ category: null })} className={pill(!activeCategory)}>
                    {t("shop.all")}
                  </Link>
                </li>
                {categories.map((c) => (
                  <li key={c.slug}>
                    <Link to={withParams({ category: c.slug })} className={pill(activeCategory === c.slug)}>
                      {p(c, "name")}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {/* A plain GET form: works without JavaScript, and every filter state is a shareable URL. */}
            <Form method="get" action={base} className="space-y-3">
              {activeCategory && <input type="hidden" name="category" value={activeCategory} />}
              <div className="flex flex-wrap gap-2">
                <label className="min-w-40 flex-1 md:max-w-xs">
                  <span className="sr-only">{t("shop.search")}</span>
                  <input
                    type="search"
                    name="q"
                    defaultValue={query.get("q") ?? ""}
                    placeholder={t("shop.searchPlaceholder")}
                    maxLength={80}
                    className="field"
                  />
                </label>
                <label>
                  <span className="sr-only">{t("shop.sort")}</span>
                  <select
                    name="sort"
                    defaultValue={query.get("sort") ?? "featured"}
                    onChange={(event) => submit(event.currentTarget.form)}
                    className="field"
                  >
                    {SORTS.map((s) => (
                      <option key={s} value={s}>
                        {t(`shop.sort.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="btn btn-primary">
                  {t("shop.apply")}
                </button>
              </div>

              <details open={hasFilters} className="group">
                <summary className="label inline-flex cursor-pointer list-none items-center border border-ink px-4 py-3">
                  {t("shop.filters")}
                </summary>
                <div className="mt-4 grid gap-6 md:grid-cols-4">
                  {facets.sizes.length > 0 && (
                    <fieldset>
                      <legend className="label mb-2 text-stone">{t("shop.size")}</legend>
                      <div className="flex flex-wrap gap-2">
                        {facets.sizes.map((size) => (
                          <label key={size} className="cursor-pointer">
                            <input
                              type="checkbox"
                              name="size"
                              value={size}
                              defaultChecked={query.getAll("size").includes(size)}
                              className="peer sr-only"
                            />
                            <span className="block min-w-11 border border-line bg-card px-3 py-2 text-center text-sm peer-checked:border-ink peer-checked:bg-ink peer-checked:text-bone peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2" dir="ltr">
                              {size}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  {facets.colors.length > 0 && (
                    <fieldset>
                      <legend className="label mb-2 text-stone">{t("shop.colour")}</legend>
                      <div className="space-y-2">
                        {facets.colors.map((c) => (
                          <label key={c.nameEn} className="flex cursor-pointer items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              name="color"
                              value={c.nameEn}
                              defaultChecked={query.getAll("color").includes(c.nameEn)}
                              className="h-4 w-4 accent-ink"
                            />
                            <span className="h-3.5 w-3.5 rounded-full border border-line" style={{ backgroundColor: c.hex }} />
                            {p(c, "name")}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <fieldset>
                    <legend className="label mb-2 text-stone">{t("shop.price")}</legend>
                    <div className="flex gap-2">
                      {(["minPrice", "maxPrice"] as const).map((name) => (
                        <label key={name} className="flex-1">
                          <span className="sr-only">{t(name === "minPrice" ? "shop.min" : "shop.max")}</span>
                          <input
                            type="number"
                            name={name}
                            min={0}
                            step={1}
                            inputMode="numeric"
                            defaultValue={query.get(name) ?? ""}
                            placeholder={t(name === "minPrice" ? "shop.min" : "shop.max")}
                            className="field"
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="space-y-2">
                    {(["sale", "inStock"] as const).map((flag) => (
                      <label key={flag} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name={flag}
                          value="true"
                          defaultChecked={query.get(flag) === "true"}
                          className="h-4 w-4 accent-ink"
                        />
                        {t(flag === "sale" ? "shop.onSale" : "shop.inStock")}
                      </label>
                    ))}
                    {hasFilters && (
                      <Link to={withParams(Object.fromEntries([...SINGLE, ...MULTI, ...FLAGS].filter((k) => k !== "category" && k !== "sort").map((k) => [k, null])))} className="inline-block pt-2 text-sm underline">
                        {t("shop.clear")}
                      </Link>
                    )}
                  </fieldset>
                </div>
              </details>
            </Form>
          </div>

          <p className="py-5 text-sm text-stone" aria-live="polite">
            {t("shop.styles", { count: products.total })}
          </p>
          {products.items.length > 0 ? (
            <ProductGrid products={products.items} heading="h2" />
          ) : (
            <p className="py-16 text-center text-stone">{t("shop.noResults")}</p>
          )}

          {products.totalPages > 1 && (
            <nav className="mt-12 flex items-center justify-center gap-4" aria-label={t("shop.pageOf", { page: products.page + 1, pages: products.totalPages })}>
              {products.page > 0 ? (
                <Link to={pageLink(base, query, products.page)} rel="prev" className="btn btn-outline">
                  {t("shop.prev")}
                </Link>
              ) : null}
              <span className="text-sm text-stone">
                {t("shop.pageOf", { page: products.page + 1, pages: products.totalPages })}
              </span>
              {products.page + 1 < products.totalPages ? (
                <Link to={pageLink(base, query, products.page + 2)} rel="next" className="btn btn-outline">
                  {t("shop.next")}
                </Link>
              ) : null}
            </nav>
          )}
        </>
      )}
    </div>
  );
}

/** `page` is 1-based in the URL; page 1 has no parameter. */
function pageLink(base: string, query: URLSearchParams, page: number): string {
  const next = new URLSearchParams(query);
  if (page <= 1) next.delete("page");
  else next.set("page", String(page));
  const text = next.toString();
  return text ? `${base}?${text}` : base;
}
