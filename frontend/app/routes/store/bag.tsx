import { useQueries } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/bag";
import { ProductPhoto } from "~/components/product";
import { useBagState } from "~/features/bag/store";
import { useBag } from "~/features/bag/useBag";
import { api } from "~/lib/http";
import { toLang, translate, useT } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";
import type { ProductDetail } from "~/lib/types";

export function meta({ params, matches, location }: Route.MetaArgs) {
  const title = translate(toLang(params.lang), "bag.title");
  return seo({ origin: layoutOrigin(matches), pathname: location.pathname, title, description: title, noindex: true });
}

export default function Bag() {
  const { t, href, pick, money, code } = useT();
  const { favourites } = useBagState();
  // Names, prices and availability always come from the server, signed in or not.
  const bag = useBag();
  const { items, signedIn, setQuantity } = bag;

  // If stock dropped since the item was added, lower the quantity to what can still be bought.
  useEffect(() => {
    for (const item of items) {
      if (item.purchasable && item.maxQuantity > 0 && item.quantity > item.maxQuantity) {
        setQuantity(item.variantId, item.maxQuantity);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const saved = useQueries({
    queries: favourites.slice(0, 12).map((slug) => ({
      queryKey: ["favourite", slug],
      queryFn: () => api<ProductDetail>("GET", `/api/v1/catalog/products/${encodeURIComponent(slug)}`),
      staleTime: 60_000,
      retry: false,
    })),
  });

  const canCheckout = items.some((i) => i.purchasable) && items.every((i) => i.purchasable && i.quantity <= i.maxQuantity);
  const checkoutHref = signedIn ? href("/checkout") : `${href("/sign-in")}?next=${encodeURIComponent(href("/checkout"))}`;

  return (
    <div className="shell pt-10">
      <h1 className="display text-3xl md:text-4xl">{t("bag.title")}</h1>

      {bag.isEmpty ? (
        <div className="mt-10 border-y border-line py-16 text-center">
          <p className="text-stone">{t("bag.empty")}</p>
          <Link to={href("/shop")} className="btn btn-primary mt-6">{t("bag.continue")}</Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
          <ul className="border-t border-line" aria-busy={bag.isPending}>
            {bag.isPending && <li className="py-6 text-sm text-stone">{t("bag.loading")}</li>}
            {bag.isError && <li className="py-6 text-sm text-danger" role="alert">{t("error.generic")}</li>}
            {bag.changeError && (
              <li className="py-4 text-sm text-danger" role="alert">{code("err", bag.changeError.code)}</li>
            )}
            {items.map((item) => {
              const name = pick(item, "name");
              if (!item.purchasable) {
                return (
                  <li key={item.variantId} className="flex items-center justify-between gap-4 border-b border-line py-5 text-sm">
                    <span className="text-stone">
                      {name ? `${name} — ` : ""}
                      {t("bag.unavailable")}
                    </span>
                    <button type="button" className="cursor-pointer underline" onClick={() => bag.remove(item.variantId)}>
                      {t("bag.remove")}
                    </button>
                  </li>
                );
              }
              return (
                <li key={item.variantId} className="flex gap-4 border-b border-line py-5">
                  <Link to={href(`/product/${item.productSlug}`)} className="shrink-0">
                    <ProductPhoto url={item.imageUrl} alt={name} sizes="80px" className="h-24 w-20" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-sm font-semibold">
                        <Link to={href(`/product/${item.productSlug}`)}>{name}</Link>
                      </h2>
                      <span className="shrink-0 text-sm font-bold">{money(item.lineTotal)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-stone">
                      {pick(item, "color")} · {t("product.size")} <span dir="ltr">{item.sizeCode}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-stone">{t("bag.each", { price: money(item.unitPrice) })}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex h-10 items-center border border-line bg-card" role="group" aria-label={t("product.quantity")}>
                        <button
                          type="button"
                          className="h-full w-10 cursor-pointer disabled:opacity-40"
                          disabled={item.quantity <= 1}
                          onClick={() => bag.setQuantity(item.variantId, item.quantity - 1)}
                          aria-label={t("product.decrease")}
                        >
                          −
                        </button>
                        <output className="w-8 text-center text-sm">{item.quantity}</output>
                        <button
                          type="button"
                          className="h-full w-10 cursor-pointer disabled:opacity-40"
                          disabled={item.quantity >= item.maxQuantity}
                          onClick={() => bag.setQuantity(item.variantId, item.quantity + 1)}
                          aria-label={t("product.increase")}
                        >
                          +
                        </button>
                      </div>
                      <button type="button" className="cursor-pointer text-xs underline" onClick={() => bag.remove(item.variantId)}>
                        {t("bag.remove")}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <aside className="h-fit border border-line bg-card p-5" aria-labelledby="summary-title">
            <h2 id="summary-title" className="label">{t("bag.summary")}</h2>
            <p className="mt-4 flex items-baseline justify-between text-sm">
              <span>{t("bag.subtotal")}</span>
              <span className="text-base font-bold" aria-live="polite">{bag.isPending ? "…" : money(bag.subtotal)}</span>
            </p>
            <p className="mt-3 text-xs text-stone">{t("bag.note")}</p>
            {canCheckout ? (
              <Link to={checkoutHref} className="btn btn-primary mt-5 w-full">{t("bag.checkout")}</Link>
            ) : (
              <button type="button" className="btn btn-primary mt-5 w-full" disabled>{t("bag.checkout")}</button>
            )}
            <Link to={href("/shop")} className="mt-4 block text-center text-sm underline">{t("bag.continue")}</Link>
          </aside>
        </div>
      )}

      {favourites.length > 0 && (
        <section id="favourites" className="scroll-mt-28 pt-16" aria-labelledby="favourites-title">
          <h2 id="favourites-title" className="text-lg font-bold">{t("bag.favourites")}</h2>
          <ul className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            {saved.map((query, i) => {
              const product = query.data;
              if (!product) return null;
              const name = pick(product, "name");
              return (
                <li key={favourites[i]}>
                  <Link to={href(`/product/${product.slug}`)} className="block">
                    <ProductPhoto url={product.colors[0]?.images[0]?.url} alt={name} sizes="(min-width: 1024px) 16vw, 50vw" className="aspect-[4/5] w-full" />
                    <span className="mt-2 block text-sm">{name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
