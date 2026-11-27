import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/product";
import { announceBagAdded } from "~/components/bag-added";
import { ShareIcon } from "~/components/icons";
import { FavouriteButton, Price, ProductGrid, ProductPhoto } from "~/components/product";
import { SizeGuidePanel } from "~/components/size-guide";
import { SizeFinder } from "~/components/size-finder";
import { ProductReviews } from "~/components/reviews";
import { useBag } from "~/features/bag/useBag";
import { api } from "~/lib/http";
import { apiGet } from "~/lib/api.server";
import { localePath, pick, toLang, translate, useT } from "~/lib/i18n";
import { track } from "~/lib/pixel";
import { relatedPieces } from "~/lib/related";
import { absoluteUrl, layoutOrigin, RETURN_POLICY, seo } from "~/lib/seo";
import type { LookCard, Page, ProductCard, ProductDetail } from "~/lib/types";

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
  const images = product.colors.flatMap((c) => c.images.map((i) => absoluteUrl(origin, i.url)));
  const url = origin + location.pathname;
  const inStock = product.colors.some((c) => c.variants.some((v) => v.available));
  const crumbs = [
    { name: translate(lang, "product.home"), path: "/" },
    { name: pick(lang, product.department, "name"), path: `/shop/${product.department.slug}` },
    { name, path: `/product/${product.slug}` },
  ];
  return [
    ...seo({ origin, pathname: location.pathname, title: name, description, image: images[0], type: "product" }),
    { property: "product:price:amount", content: (product.salePrice ?? product.price).toFixed(2) },
    { property: "product:price:currency", content: "EGP" },
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "Product",
        name,
        description,
        ...(images.length ? { image: images } : {}),
        // Only the maker the owner entered. Many pieces are other labels' (e.g. Bershka), so naming
        // LUPIN. as the brand when the field is empty would tell Google something untrue.
        ...(product.brand ? { brand: { "@type": "Brand", name: product.brand } } : {}),
        category: pick(lang, product.category, "name"),
        offers: {
          "@type": "Offer",
          url,
          priceCurrency: "EGP",
          price: (product.salePrice ?? product.price).toFixed(2),
          availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          itemCondition: "https://schema.org/NewCondition",
          seller: { "@type": "Organization", "@id": `${origin}/#organization`, name: "LUPIN." },
          hasMerchantReturnPolicy: RETURN_POLICY,
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
  // A card's colour swatch links here with ?color=<name>, so the page opens on the colour the shopper chose.
  const [search] = useSearchParams();
  const wanted = search.get("color")?.toLowerCase();
  const [colorId, setColorId] = useState(
    (wanted && product.colors.find((c) => c.nameEn.toLowerCase() === wanted)?.id) || product.colors[0]?.id,
  );
  const [photo, setPhoto] = useState(0);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState<"added" | "size" | "copied" | null>(null);
  const navigate = useNavigate();
  const [buying, setBuying] = useState(false);
  // On phones a bar with the price and "Add to bag" stays at the bottom once the main button scrolls away.
  const buyRef = useRef<HTMLDivElement>(null);
  const [showBar, setShowBar] = useState(false);
  // A scroll listener, not an IntersectionObserver: a fast fling can jump past the button without it ever
  // being on screen, and the observer then never reports a change.
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = buyRef.current;
      if (el) setShowBar(el.getBoundingClientRect().bottom < 0);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(check); };
    check();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (showBar) root.dataset.stickyBuy = "";
    else delete root.dataset.stickyBuy;
    return () => { delete root.dataset.stickyBuy; };
  }, [showBar]);
  const bag = useBag();
  const viewPrice = product.salePrice ?? product.price;
  useEffect(() => {
    track("ViewContent", { content_ids: [String(product.id)], content_type: "product", content_name: product.nameEn, value: viewPrice, currency: "EGP" });
  }, [product.id, product.nameEn, viewPrice]);
  const looks = useQuery({
    queryKey: ["looks-with", product.slug],
    queryFn: () => api<LookCard[]>("GET", `/api/v1/catalog/looks?product=${encodeURIComponent(product.slug)}`),
    staleTime: 60_000,
  });
  const seenIn = looks.data?.[0];
  // "You may also steal": other pieces from the same department, same category first, at most four.
  const related = useQuery({
    queryKey: ["related", product.slug],
    queryFn: () => api<Page<ProductCard>>("GET", `/api/v1/catalog/products?department=${encodeURIComponent(product.department.slug)}&pageSize=12`),
    staleTime: 60_000,
  });
  const alsoSteal = relatedPieces(product, related.data?.items ?? []);

  const color = product.colors.find((c) => c.id === colorId) ?? product.colors[0];
  if (!color) return null;
  const variant = color.variants.find((v) => v.id === variantId) ?? null;
  const name = p(product, "name");
  const anyAvailable = color.variants.some((v) => v.available);
  const max = variant?.maxQuantity ?? 1;
  const unit = product.salePrice ?? product.price;

  const chooseColor = (id: number) => {
    setColorId(id);
    setPhoto(0);
    setVariantId(null);
    setQuantity(1);
    setNotice(null);
  };

  /** No size chosen yet: say so where the sizes are. */
  const askForSize = () => {
    setNotice("size");
    document.getElementById("sizes")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /** Puts the piece in the bag and goes straight to checkout (via sign-in or guest, as from the bag). */
  const buyNow = async () => {
    if (!variant) {
      askForSize();
      return;
    }
    const qty = Math.min(quantity, max);
    setBuying(true);
    try {
      await bag.addAndWait(variant.id, qty);
      track("AddToCart", { content_ids: [String(product.id)], content_type: "product", value: unit * qty, currency: "EGP", num_items: qty });
      navigate(bag.signedIn ? href("/checkout") : `${href("/sign-in")}?next=${encodeURIComponent(href("/checkout"))}`);
    } finally {
      setBuying(false);
    }
  };

  const addToBag = () => {
    if (!variant) {
      if (showBar) askForSize();
      else setNotice("size");
      return;
    }
    const qty = Math.min(quantity, max);
    bag.add(variant.id, qty);
    setNotice("added");
    track("AddToCart", { content_ids: [String(product.id)], content_type: "product", value: unit * qty, currency: "EGP", num_items: qty });
    // Fly the photo the shopper is looking at (the one most on screen) into the bag icon.
    const onScreen = (el: HTMLImageElement) => {
      const r = el.getBoundingClientRect();
      const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
      const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
      return h * w;
    };
    const shown = [...document.querySelectorAll<HTMLImageElement>("[data-gallery] img")].sort(
      (a, b) => onScreen(b) - onScreen(a),
    )[0];
    const rect = shown && onScreen(shown) > 0 ? shown.getBoundingClientRect() : null;
    announceBagAdded({
      imageUrl: shown?.currentSrc || color.images[0]?.url,
      name,
      colour: p(color, "name"),
      size: variant.sizeCode,
      quantity: qty,
      from: rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : undefined,
    });
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

      <div className="mt-5 grid gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-14">
        {/* Phones: one photo at a time, swiped sideways. Larger screens: every photo, large, one under
            another, each unveiled as it scrolls in while the details stay beside them. */}
        <div className="-mx-5 md:mx-0">
          {color.images.length === 0 ? (
            <ProductPhoto url={undefined} alt={name} sizes="100vw" className="aspect-[4/5] w-full" />
          ) : (
            <>
              <ul
                key={color.id}
                data-gallery
                aria-label={p(color, "name")}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  setPhoto(Math.round(Math.abs(el.scrollLeft) / el.clientWidth));
                }}
                className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] md:block md:space-y-3 md:overflow-visible"
              >
                {color.images.map((image, i) => (
                  <li
                    key={image.url}
                    data-reveal={i === 0 ? undefined : "photo"}
                    className="w-full shrink-0 snap-center overflow-hidden bg-studio"
                  >
                    <ProductPhoto
                      url={image.url}
                      alt={p(image, "alt") || `${name} — ${p(color, "name")} (${t("product.photoOf", { n: i + 1, total: color.images.length })})`}
                      sizes="(min-width: 768px) 55vw, 100vw"
                      eager={i === 0}
                      className="aspect-[4/5] w-full"
                    />
                  </li>
                ))}
              </ul>
              {color.images.length > 1 && (
                <p className="mt-3 flex items-center justify-center gap-1.5 md:hidden" aria-hidden="true">
                  {color.images.map((image, i) => (
                    <span
                      key={image.url}
                      className={`h-px transition-all duration-500 ${i === photo ? "w-8 bg-ink" : "w-4 bg-ink/25"}`}
                    />
                  ))}
                </p>
              )}
            </>
          )}
        </div>

        <div className="md:sticky md:top-24 md:self-start">
          <p data-reveal className="label text-stone">{p(product.category, "name")}</p>
          <h1 data-reveal className="display mt-3 text-2xl md:text-3xl" style={{ "--reveal-delay": "80ms" } as CSSProperties}>
            {name}
          </h1>
          <div data-reveal className="mt-4" style={{ "--reveal-delay": "160ms" } as CSSProperties}>
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

          <fieldset id="sizes" className="mt-7 scroll-mt-24">
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
            {product.sizeGuide && (
              <SizeFinder
                guide={product.sizeGuide}
                sizes={color.variants.map((v) => v.sizeCode)}
                department={product.department.slug}
                available={(size) => color.variants.some((v) => v.sizeCode === size && v.available)}
                onPick={(size) => {
                  const v = color.variants.find((x) => x.sizeCode === size && x.available);
                  if (!v) return;
                  setVariantId(v.id);
                  setQuantity((q) => Math.min(q, v.maxQuantity));
                  setNotice(null);
                }}
              />
            )}
            {product.sizeGuide && <SizeGuidePanel guide={product.sizeGuide} sizes={color.variants.map((v) => v.sizeCode)} department={product.department.slug} />}
          </fieldset>

          <div ref={buyRef} className="mt-7 flex flex-wrap gap-2">
            <div className="flex h-12 flex-1 items-center justify-between border border-ink" role="group" aria-label={t("product.quantity")}>
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
            <button type="button" onClick={addToBag} disabled={!anyAvailable} className="btn btn-primary order-last h-14 basis-full whitespace-nowrap">
              {t("product.addToBag")} · <span dir="ltr">{money(unit * quantity)}</span>
            </button>
            <button type="button" onClick={buyNow} disabled={!anyAvailable || buying} className="btn btn-outline order-last h-12 basis-full whitespace-nowrap">
              {t("product.buyNow")}
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
          {/* The store's return window, stated where the buying decision is made, with the full policy one tap away. */}
          <p className="mt-1 text-sm text-stone">
            {t("product.returnsWindow")}{" "}
            <Link to={href("/policies/exchange-returns")} className="underline hover:text-ink">
              {t("product.returnsPolicy")}
            </Link>
          </p>

          {seenIn && (
            <Link to={href(`/looks/${seenIn.slug}`)} className="group mt-6 flex items-center gap-4 border border-line bg-card p-3">
              <span className="block w-16 shrink-0 overflow-hidden bg-studio">
                <ProductPhoto url={seenIn.imageUrl} alt="" sizes="64px" className="aspect-[2/3] w-full" />
              </span>
              <span className="min-w-0">
                <span className="label flex items-center gap-2 text-stone">
                  <span aria-hidden="true" className="h-px w-5 bg-gold" />
                  {t("look.label")}
                </span>
                <span className="mt-1 block text-sm font-medium">{p(seenIn, "title")}</span>
                <span className="mt-0.5 block text-xs text-stone group-hover:text-ink group-hover:underline">
                  {t("look.view")} · {t("look.pieces", { count: seenIn.itemCount })}
                </span>
              </span>
            </Link>
          )}

          <div className="mt-6 border-t border-line">
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

      {showBar && anyAvailable && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bone/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur md:hidden">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-stone">{name}{variant && <> · <span dir="ltr">{variant.sizeCode}</span></>}</p>
              <p className="text-sm font-bold" dir="ltr">{money(unit * quantity)}</p>
            </div>
            <button type="button" onClick={addToBag} className="btn btn-primary h-11 whitespace-nowrap px-4">
              {t("product.stickyAdd")}
            </button>
            <button type="button" onClick={buyNow} disabled={buying} className="btn btn-outline h-11 whitespace-nowrap px-4">
              {t("product.buyNow")}
            </button>
          </div>
        </div>
      )}

      <ProductReviews slug={product.slug} />

      {alsoSteal.length > 0 && (
        <section className="pt-20" aria-labelledby="also-steal-title">
          <div data-reveal className="mb-8">
            <p className="label text-stone">{t("product.completeLook")}</p>
            <h2 id="also-steal-title" className="display mt-2 text-2xl md:text-3xl">{t("product.alsoSteal")}</h2>
          </div>
          <ProductGrid products={alsoSteal} />
        </section>
      )}
    </div>
  );
}
