import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/product";
import { ShareIcon } from "~/components/icons";
import { FavouriteButton, Price, ProductPhoto } from "~/components/product";
import { useBag } from "~/features/bag/useBag";
import { apiGet } from "~/lib/api.server";
import { localePath, pick, toLang, translate, useT } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";
import type { ProductDetail } from "~/lib/types";

export async function loader({ params, context }: Route.LoaderArgs) {
  const product = await apiGet<ProductDetail>(context, `/api/v1/catalog/products/${encodeURIComponent(params.slug)}`);
  return { product };
}

export function meta({ params, matches, location, data }: Route.MetaArgs) {
  const lang = toLang(params.lang);
  if (!data) return [{ title: "LUPIN." }];
  const { product } = data;
  const origin = layoutOrigin(matches);
  const name = pick(lang, product, "name");
  const description = (pick(lang, product, "description") || name).slice(0, 160);
  const images = product.colors.flatMap((c) => c.images.map((i) => i.url));
  const url = origin + location.pathname;
  const inStock = product.colors.some((c) => c.variants.some((v) => v.available));
  const crumbs = [
    { name: translate(lang, "product.home"), path: "/" },
    { name: pick(lang, product.department, "name"), path: `/shop/${product.department.slug}` },
    { name, path: `/product/${product.slug}` },
  ];
  return [
    ...seo({ origin, pathname: location.pathname, title: name, description, image: images[0] }),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "Product",
        name,
        description,
        ...(images.length ? { image: images } : {}),
        ...(product.brand ? { brand: { "@type": "Brand", name: product.brand } } : { brand: { "@type": "Brand", name: "LUPIN." } }),
        category: pick(lang, product.category, "name"),
        offers: {
          "@type": "Offer",
          url,
          priceCurrency: "EGP",
          price: (product.salePrice ?? product.price).toFixed(2),
          availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        },
      },
    },
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((c, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: c.name,
          item: origin + localePath(lang, c.path),
        })),
      },
    },
  ];
}

export default function Product({ loaderData }: Route.ComponentProps) {
  // Keyed by slug so colour, size and quantity reset when moving from one product to another.
  return <ProductView key={loaderData.product.slug} product={loaderData.product} />;
}

function ProductView({ product }: { product: ProductDetail }) {
  const { t, href, pick: p, money } = useT();
  const [colorId, setColorId] = useState(product.colors[0]?.id);
  const [photo, setPhoto] = useState(0);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState<"added" | "size" | "copied" | null>(null);
  const bag = useBag();

  const color = product.colors.find((c) => c.id === colorId) ?? product.colors[0];
  if (!color) return null;
  const variant = color.variants.find((v) => v.id === variantId) ?? null;
  const name = p(product, "name");
  const anyAvailable = color.variants.some((v) => v.available);
  const max = variant?.maxQuantity ?? 1;
  const shown = color.images[photo] ?? color.images[0];
  const unit = product.salePrice ?? product.price;

  const chooseColor = (id: number) => {
    setColorId(id);
    setPhoto(0);
    setVariantId(null);
    setQuantity(1);
    setNotice(null);
  };

  const addToBag = () => {
    if (!variant) {
      setNotice("size");
      return;
    }
    bag.add(variant.id, Math.min(quantity, max));
    setNotice("added");
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: name, url });
      } else {
        await navigator.clipboard.writeText(url);
        setNotice("copied");
      }
    } catch {
      // The shopper closed the share sheet; nothing to report.
    }
  };

  const square = "grid h-12 w-12 place-items-center border border-ink";

  return (
    <div className="shell pt-6">
      <nav aria-label="Breadcrumb" className="text-xs text-stone">
        <ol className="flex flex-wrap gap-x-2">
          <li>
            <Link to={href("/")} className="hover:text-ink">{t("product.home")}</Link> <span aria-hidden="true">/</span>
          </li>
          <li>
            <Link to={href(`/shop/${product.department.slug}`)} className="hover:text-ink">
              {p(product.department, "name")}
            </Link>{" "}
            <span aria-hidden="true">/</span>
          </li>
          <li>
            <Link to={href(`/shop/${product.department.slug}`) + `?category=${product.category.slug}`} className="hover:text-ink">
              {p(product.category, "name")}
            </Link>{" "}
            <span aria-hidden="true">/</span>
          </li>
          <li aria-current="page" className="text-ink">{name}</li>
        </ol>
      </nav>

      <div className="mt-5 grid gap-8 md:grid-cols-2 md:gap-12">
        <div>
          <ProductPhoto
            url={shown?.url}
            alt={(shown && p(shown, "alt")) || `${name} — ${p(color, "name")}`}
            sizes="(min-width: 768px) 45vw, 100vw"
            eager
            className="aspect-[4/5] w-full"
          />
          {color.images.length > 1 && (
            <ul className="mt-2 flex gap-2 overflow-x-auto">
              {color.images.map((image, i) => (
                <li key={image.url}>
                  <button
                    type="button"
                    onClick={() => setPhoto(i)}
                    aria-label={t("product.photoOf", { n: i + 1, total: color.images.length })}
                    aria-current={i === photo}
                    className={`block cursor-pointer border-2 ${i === photo ? "border-ink" : "border-transparent"}`}
                  >
                    <ProductPhoto url={image.url} alt="" sizes="64px" className="h-20 w-16" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="label text-stone">{p(product.category, "name")}</p>
          <h1 className="mt-2 text-3xl font-bold md:text-4xl">{name}</h1>
          <div className="mt-3">
            <Price price={product.price} salePrice={product.salePrice} large />
          </div>
          {p(product, "description") && (
            <p className="mt-4 max-w-prose text-sm leading-relaxed text-stone">{p(product, "description")}</p>
          )}

          <fieldset className="mt-7">
            <legend className="text-sm">
              <span className="font-semibold">{t("product.colour")}:</span> {p(color, "name")}
            </legend>
            <div className="mt-3 flex gap-3">
              {product.colors.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => chooseColor(c.id)}
                  aria-pressed={c.id === color.id}
                  aria-label={p(c, "name")}
                  title={p(c, "name")}
                  className={`h-9 w-9 cursor-pointer rounded-full border border-line ring-offset-2 ring-offset-paper ${c.id === color.id ? "ring-2 ring-ink" : ""}`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-7">
            <legend className="text-sm">
              <span className="font-semibold">{t("product.size")}:</span>{" "}
              <span dir="ltr">{variant?.sizeCode ?? t("product.selectSize")}</span>
            </legend>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {color.variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  disabled={!v.available}
                  onClick={() => {
                    setVariantId(v.id);
                    setQuantity((q) => Math.min(q, v.maxQuantity));
                    setNotice(null);
                  }}
                  aria-pressed={v.id === variantId}
                  aria-label={v.available ? v.sizeCode : t("product.soldOutSize", { size: v.sizeCode })}
                  dir="ltr"
                  className={`min-h-11 border text-sm font-semibold ${
                    !v.available
                      ? "cursor-not-allowed border-line bg-bone text-stone line-through"
                      : v.id === variantId
                        ? "cursor-pointer border-ink bg-ink text-bone"
                        : "cursor-pointer border-line bg-card hover:border-ink"
                  }`}
                >
                  {v.sizeCode}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mt-7 flex gap-2">
            <div className="flex h-12 items-center border border-ink" role="group" aria-label={t("product.quantity")}>
              <button
                type="button"
                className="h-full w-11 cursor-pointer disabled:opacity-40"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                aria-label={t("product.decrease")}
              >
                −
              </button>
              <output className="w-8 text-center text-sm font-semibold" aria-live="polite">{quantity}</output>
              <button
                type="button"
                className="h-full w-11 cursor-pointer disabled:opacity-40"
                onClick={() => setQuantity((q) => Math.min(max, q + 1))}
                disabled={!variant || quantity >= max}
                aria-label={t("product.increase")}
              >
                +
              </button>
            </div>
            <button type="button" onClick={addToBag} disabled={!anyAvailable} className="btn btn-primary h-12 flex-1">
              {t("product.addToBag")} · <span dir="ltr">{money(unit * quantity)}</span>
            </button>
            <FavouriteButton slug={product.slug} className={`${square} h-12 w-12`} />
            <button type="button" onClick={share} aria-label={t("product.share")} className={`${square} cursor-pointer`}>
              <ShareIcon />
            </button>
          </div>

          <p className="mt-3 min-h-5 text-sm" role="status" aria-live="polite">
            {notice === "added" && (
              <>
                {t("product.added")}{" "}
                <Link to={href("/bag")} className="font-semibold underline">{t("product.viewBag")}</Link>
              </>
            )}
            {notice === "size" && <span className="text-danger">{t("product.chooseSizeFirst")}</span>}
            {notice === "copied" && t("product.linkCopied")}
            {notice === null && <span className="text-stone">{t(anyAvailable ? "product.inStock" : "product.allTaken")}</span>}
          </p>

          <div className="mt-6 border-t border-line">
            {p(product, "description") && (
              <details open className="border-b border-line py-4">
                <summary className="cursor-pointer text-sm font-semibold">{t("product.description")}</summary>
                <p className="mt-3 text-sm leading-relaxed text-stone">{p(product, "description")}</p>
              </details>
            )}
            {(p(product, "fabric") || p(product, "fit")) && (
              <details className="border-b border-line py-4">
                <summary className="cursor-pointer text-sm font-semibold">{t("product.fabricFit")}</summary>
                <dl className="mt-3 space-y-2 text-sm text-stone">
                  {p(product, "fabric") && (
                    <div>
                      <dt className="inline font-semibold text-ink">{t("product.fabric")}: </dt>
                      <dd className="inline">{p(product, "fabric")}</dd>
                    </div>
                  )}
                  {p(product, "fit") && (
                    <div>
                      <dt className="inline font-semibold text-ink">{t("product.fit")}: </dt>
                      <dd className="inline">{p(product, "fit")}</dd>
                    </div>
                  )}
                </dl>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
