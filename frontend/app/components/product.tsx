import { Link } from "react-router";
import { bagActions, useBagState } from "~/features/bag/store";
import { useT } from "~/lib/i18n";
import type { ProductCard as Card } from "~/lib/types";
import { HeartIcon } from "./icons";

const WIDTHS = [320, 480, 640, 960, 1280];

/** Cloudinary delivery URL at a given width, in the best format the browser accepts. */
export function cloudinary(url: string, width: number): string {
  const marker = "/image/upload/";
  const at = url.indexOf(marker);
  if (at === -1) return url;
  const head = url.slice(0, at + marker.length);
  return `${head}f_auto,q_auto,c_limit,w_${width}/${url.slice(at + marker.length)}`;
}

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
        className={`grid place-items-center bg-bone text-stone ${className}`}
      >
        <span className="label px-3 text-center">{t("product.photoSoon")}</span>
      </div>
    );
  }
  return (
    <img
      src={cloudinary(url, 960)}
      srcSet={WIDTHS.map((w) => `${cloudinary(url, w)} ${w}w`).join(", ")}
      sizes={sizes}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : undefined}
      className={`bg-bone object-cover ${className}`}
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

export function FavouriteButton({ slug, className = "" }: { slug: string; className?: string }) {
  const { t } = useT();
  const saved = useBagState().favourites.includes(slug);
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={t(saved ? "product.unsave" : "product.save")}
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
  const badge =
    product.discountPercent != null
      ? `−${product.discountPercent}%`
      : product.badge
        ? t(`badge.${product.badge}`)
        : null;
  return (
    <article className="group relative">
      <Link to={href(`/product/${product.slug}`)} className="block">
        <div className="relative aspect-[4/5] overflow-hidden">
          <ProductPhoto
            url={product.colors[0]?.imageUrl}
            alt={name}
            sizes="(min-width: 1024px) 25vw, 50vw"
            eager={eager}
            className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]"
          />
          {badge && (
            <span className="label absolute start-2 top-2 bg-ink px-2 py-1 text-bone" dir="ltr">
              {badge}
            </span>
          )}
          {!product.inStock && (
            <span className="label absolute inset-x-0 bottom-0 bg-paper/90 py-2 text-center">
              {t("card.soldOut")}
            </span>
          )}
        </div>
        <p className="label mt-3 text-stone">{pick(product, "category")}</p>
        <Heading className="mt-1 text-sm font-medium">{name}</Heading>
      </Link>
      <div className="mt-1 flex items-center justify-between gap-2">
        <Price price={product.price} salePrice={product.salePrice} />
        {product.colors.length > 1 && (
          <span className="flex items-center gap-1.5 text-xs text-stone">
            <span className="flex gap-1" aria-hidden="true">
              {product.colors.slice(0, 4).map((c) => (
                <span
                  key={c.nameEn}
                  className="h-2.5 w-2.5 rounded-full border border-line"
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </span>
            {t("card.colours", { count: product.colors.length })}
          </span>
        )}
      </div>
      <FavouriteButton slug={product.slug} className="absolute end-0 top-0" />
    </article>
  );
}

export function ProductGrid({ products, heading }: { products: Card[]; heading?: "h2" | "h3" }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">
      {products.map((product, i) => (
        <li key={product.slug}>
          <ProductCard product={product} eager={i < 4} heading={heading} />
        </li>
      ))}
    </ul>
  );
}
