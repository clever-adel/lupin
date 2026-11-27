import { useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { bagActions, useBagState } from "~/features/bag/store";
import { useT } from "~/lib/i18n";
import type { ProductCard as Card } from "~/lib/types";
import { HeartIcon } from "./icons";
import { photoSrcSet, photoUrl } from "~/lib/photo-sizes";

interface PhotoProps {
  url?: string;
  alt: string;
  /** CSS sizes attribute: how wide the photo is shown at each breakpoint. */
  sizes: string;
  eager?: boolean;
  className?: string;
}

/**
 * A product photo, or a clearly labelled placeholder while the real photo does not exist yet.
 * Stock imagery is never substituted.
 */
export function ProductPhoto({ url, alt, sizes, eager, className = "" }: PhotoProps) {
  const { t } = useT();
  if (!url) {
    return (
      <div
        role="img"
        aria-label={`${alt} — ${t("product.photoSoon")}`}
        className={`grid place-items-center bg-studio text-stone ${className}`}
      >
        <span className="label px-3 text-center">{t("product.photoSoon")}</span>
      </div>
    );
  }
  return (
    <img
      src={photoUrl(url, 960)}
      srcSet={photoSrcSet(url)}
      sizes={sizes}
      alt={alt}
      // Every product photo is shown in a 4:5 frame. The attributes give browsers and crawlers that
      // shape before the file arrives; CSS still sets the real size.
      width={960}
      height={1200}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : undefined}
      className={`bg-studio object-cover ${className}`}
    />
  );
}

export function Price({ price, salePrice, large }: { price: number; salePrice?: number; large?: boolean }) {
  const { money } = useT();
  const size = large ? "text-xl" : "text-sm";
  if (salePrice == null) {
    return <span className={`${size} font-bold`}>{money(price)}</span>;
  }
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className={`${size} font-bold`}>{money(salePrice)}</span>
      <s className="text-xs text-stone">{money(price)}</s>
    </span>
  );
}

/** `name` is given on product cards, so each heart in a grid says which piece it saves. */
export function FavouriteButton({ slug, name, className = "" }: { slug: string; name?: string; className?: string }) {
  const { t } = useT();
  const saved = useBagState().favourites.includes(slug);
  const label = name
    ? t(saved ? "product.unsaveNamed" : "product.saveNamed", { name })
    : t(saved ? "product.unsave" : "product.save");
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={label}
      onClick={() => bagActions.toggleFavourite(slug)}
      className={`grid h-11 w-11 cursor-pointer place-items-center ${className}`}
    >
      <HeartIcon filled={saved} />
    </button>
  );
}

/** `heading` is the level that fits the page outline: h2 directly under a page title, h3 inside a section. */
export function ProductCard({ product, eager, heading: Heading = "h3" }: { product: Card; eager?: boolean; heading?: "h2" | "h3" }) {
  const { t, href, pick } = useT();
  const name = pick(product, "name");
  const label =
    product.badge === "CUSTOM"
      ? pick(product, "badge") || null
      : product.badge
        ? t(`badge.${product.badge}`)
        : null;
  const discount = product.discountPercent != null ? `−${product.discountPercent}%` : null;
  // The colour being looked at: pointing at, focusing or tapping a swatch shows that colour's photos,
  // and opening the card then lands on that colour.
  const [active, setActive] = useState(0);
  const colour = product.colors[active] ?? product.colors[0];
  const link = href(`/product/${product.slug}`) + (active > 0 && colour ? `?color=${encodeURIComponent(colour.nameEn)}` : "");
  const MAX_SWATCHES = 6;
  return (
    <article className="group relative">
      <Link to={link} className="block">
        <div className="card-media relative aspect-[4/5] overflow-hidden bg-studio">
          <ProductPhoto
            key={colour?.imageUrl}
            url={colour?.imageUrl}
            alt={product.colors.length > 1 && colour ? `${name} — ${pick(colour, "name")}` : name}
            sizes="(min-width: 1024px) 25vw, 50vw"
            eager={eager}
            className="h-full w-full transition-transform duration-[1200ms] ease-[var(--ease-out)] group-hover:scale-[1.03]"
          />
          {colour?.hoverImageUrl && (
            <ProductPhoto
              key={colour.hoverImageUrl}
              url={colour.hoverImageUrl}
              alt=""
              sizes="(min-width: 1024px) 25vw, 50vw"
              className="card-hover-photo absolute inset-0 h-full w-full"
            />
          )}
          {(label || discount) && (
            <span className="absolute start-2 top-2 flex flex-col items-start gap-1">
              {label && <span className="label bg-ink px-2 py-1 text-bone">{label}</span>}
              {discount && (
                <span className="label bg-ink px-2 py-1 text-bone" dir="ltr">
                  {discount}
                </span>
              )}
            </span>
          )}
          {!product.inStock && (
            <span className="label absolute inset-x-0 bottom-0 bg-paper/90 py-2 text-center">
              {t("card.soldOut")}
            </span>
          )}
        </div>
        <span aria-hidden="true" className="card-rule block h-px bg-ink" />
        <p className="label mt-3 text-stone">{pick(product, "category")}</p>
        <Heading className="mt-1 text-sm font-medium">{name}</Heading>
      </Link>
      <div className="mt-1">
        <Price price={product.price} salePrice={product.salePrice} />
      </div>
      {product.colors.length > 1 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2" role="group" aria-label={t("card.colours", { count: product.colors.length })}>
          {product.colors.slice(0, MAX_SWATCHES).map((c, i) => (
            <button
              key={c.nameEn}
              type="button"
              title={pick(c, "name")}
              aria-label={t("card.showColour", { name: pick(c, "name") })}
              aria-pressed={i === active}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              className={`h-6 w-6 cursor-pointer rounded-full border border-line ring-offset-2 ring-offset-paper transition-shadow ${
                i === active ? "ring-1 ring-ink" : "hover:ring-1 hover:ring-stone"
              }`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
          {product.colors.length > MAX_SWATCHES && (
            <span className="text-xs text-stone">+{product.colors.length - MAX_SWATCHES}</span>
          )}
          <span className="ms-auto text-xs text-stone">{colour ? pick(colour, "name") : ""}</span>
        </div>
      )}
      <FavouriteButton slug={product.slug} name={name} className="absolute end-0 top-0" />
    </article>
  );
}

/**
 * `atTop`: the grid starts on the first screen (the shop page). Its first row then enters from the first
 * paint, without waiting for JavaScript; the rest still rises in as it scrolls into view.
 */
export function ProductGrid({ products, heading, atTop }: { products: Card[]; heading?: "h2" | "h3"; atTop?: boolean }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">
      {products.map((product, i) => (
        <li
          key={product.slug}
          {...(atTop && i < 4 ? { "data-enter": "" } : { "data-reveal": "" })}
          style={{ "--reveal-delay": `${(i % 4) * 90}ms` } as CSSProperties}
        >
          <ProductCard product={product} eager={i < 4} heading={heading} />
        </li>
      ))}
    </ul>
  );
}
