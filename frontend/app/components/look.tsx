import { useQuery } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { Price, ProductPhoto } from "~/components/product";
import { useBag } from "~/features/bag/useBag";
import { api, ApiError } from "~/lib/http";
import { useT } from "~/lib/i18n";
import type { LookCard, LookColor, LookDetail, LookItem } from "~/lib/types";

/** What the shopper has chosen for one piece: a colour (the one in the photo by default) and a size. */
interface Choice {
  colorId: number;
  variantId: number | null;
}

type Notice =
  | { kind: "all" }
  | { kind: "one"; name: string }
  | { kind: "some"; added: number; total: number }
  | { kind: "sizes" }
  | { kind: "error"; message: string }
  | null;

const unitPrice = (item: LookItem) => item.salePrice ?? item.price;

function colorOf(item: LookItem, colorId: number): LookColor | undefined {
  return item.colors.find((c) => c.id === colorId) ?? item.colors[0];
}

/**
 * The model photo with everything worn in it beside it. Each piece can be added on its own, or the
 * whole look at once; prices and stock are the server's, read when the page loaded and checked again
 * when adding. `onSwitch` lets a host page change looks without leaving the page.
 */
export function ShopTheLook({
  look,
  looks = [],
  onSwitch,
  headingLevel: Heading = "h2",
  switching = false,
  onBack,
}: {
  look: LookDetail;
  looks?: LookCard[];
  onSwitch?: (slug: string) => void;
  headingLevel?: "h1" | "h2";
  switching?: boolean;
  /** Shown as "All looks" above the photo: returns to the lineup. */
  onBack?: () => void;
}) {
  const { t, href, pick, money } = useT();
  const bag = useBag();
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(look.items.map((i) => [i.productSlug, { colorId: i.colorId, variantId: null }])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [missing, setMissing] = useState<Set<string>>(new Set());

  const title = pick(look, "title");
  const choiceOf = (item: LookItem) => choices[item.productSlug] ?? { colorId: item.colorId, variantId: null };
  const buyable = (item: LookItem) => (colorOf(item, choiceOf(item).colorId)?.variants ?? []).some((v) => v.available);
  const pieces = look.items.filter(buyable);
  const total = pieces.reduce((sum, i) => sum + unitPrice(i), 0);
  const fullPrice = pieces.reduce((sum, i) => sum + i.price, 0);
  // Keeps the host's order when it already lists this look, so thumbnails do not jump on switching.
  const current = { slug: look.slug, titleEn: look.titleEn, titleAr: look.titleAr, imageUrl: look.imageUrl };
  const switcher = looks.some((l) => l.slug === look.slug) ? looks : [current, ...looks];

  const choose = (item: LookItem, next: Partial<Choice>) => {
    setChoices((c) => ({ ...c, [item.productSlug]: { ...choiceOf(item), ...next } }));
    setMissing((m) => {
      const copy = new Set(m);
      copy.delete(item.productSlug);
      return copy;
    });
    setNotice(null);
  };

  const { code } = useT();
  const failed = (error: unknown) =>
    setNotice({ kind: "error", message: error instanceof ApiError ? code("err", error.code) : t("error.generic") });

  const addOne = async (item: LookItem) => {
    const variantId = choiceOf(item).variantId;
    if (!variantId) {
      setMissing(new Set([item.productSlug]));
      setNotice({ kind: "sizes" });
      return;
    }
    setBusy(item.productSlug);
    try {
      const result = await bag.addMany([{ variantId, quantity: 1 }]);
      setNotice(result.added.length ? { kind: "one", name: pick(item, "name") } : { kind: "some", added: 0, total: 1 });
    } catch (error) {
      failed(error);
    } finally {
      setBusy(null);
    }
  };

  const addAll = async () => {
    const unsized = pieces.filter((i) => !choiceOf(i).variantId).map((i) => i.productSlug);
    if (unsized.length) {
      setMissing(new Set(unsized));
      setNotice({ kind: "sizes" });
      document.getElementById(`look-item-${unsized[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy("all");
    try {
      const result = await bag.addMany(pieces.map((i) => ({ variantId: choiceOf(i).variantId!, quantity: 1 })));
      setNotice(
        result.skipped.length === 0
          ? { kind: "all" }
          : { kind: "some", added: result.added.length, total: pieces.length },
      );
    } catch (error) {
      failed(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`grid gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-12 lg:gap-16 ${switching ? "look-switching" : ""}`}>
      <figure className="md:sticky md:top-24 md:self-start">
        {onBack && (
          <button type="button" onClick={onBack} className="label mb-4 flex cursor-pointer items-center gap-2 text-stone hover:text-ink">
            <span aria-hidden="true" className="rtl:rotate-180">←</span> {t("look.all")}
          </button>
        )}
        <div key={look.slug} className="look-photo look-figure relative">
          <ProductPhoto
            url={look.imageUrl}
            alt={t("look.photoAlt", { title })}
            sizes="(min-width: 768px) 58vw, 100vw"
            eager
            className="aspect-[2/3] w-full"
          />
        </div>
        <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-stone">
          <span>{title}</span>
          {look.aiGenerated && <span>{t("look.ai")}</span>}
        </figcaption>

        {!onBack && switcher.length > 1 && (
          <div className="mt-6">
            <p className="label text-stone">{t("look.switchLook")}</p>
            <ul className="mt-3 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
              {switcher.map((l) => {
                const active = l.slug === look.slug;
                const thumb = (
                  <>
                    <ProductPhoto url={l.imageUrl} alt="" sizes="80px" className="aspect-[2/3] w-16 md:w-20" />
                    <span className="sr-only">{pick(l, "title")}</span>
                  </>
                );
                const ring = `block border transition-colors duration-300 ${active ? "border-gold" : "border-transparent hover:border-line"}`;
                return (
                  <li key={l.slug} className="shrink-0">
                    {onSwitch ? (
                      <button type="button" aria-pressed={active} onClick={() => !active && onSwitch(l.slug)} className={`${ring} cursor-pointer`}>
                        {thumb}
                      </button>
                    ) : (
                      <Link to={href(`/looks/${l.slug}`)} aria-current={active ? "page" : undefined} className={ring}>
                        {thumb}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </figure>

      <section aria-labelledby={`look-${look.slug}-title`}>
        <p className="label flex items-center gap-3 text-stone">
          <span aria-hidden="true" className="h-px w-8 bg-gold" />
          {t("look.label")}
        </p>
        <Heading id={`look-${look.slug}-title`} className="display mt-3 text-2xl md:text-3xl">
          {title}
        </Heading>
        {pick(look, "description") && <p className="mt-3 max-w-prose text-sm leading-relaxed text-stone">{pick(look, "description")}</p>}

        <div className="mt-8 flex items-baseline justify-between border-b border-ink pb-3">
          <h3 className="label">{t("look.inThisLook")}</h3>
          <span className="text-xs text-stone">{t("look.pieces", { count: look.items.length })}</span>
        </div>

        <ol className="divide-y divide-line">
          {look.items.map((item, index) => (
            <LookPiece
              key={item.productSlug}
              item={item}
              index={index}
              choice={choiceOf(item)}
              needsSize={missing.has(item.productSlug)}
              busy={busy === item.productSlug}
              disabled={busy !== null}
              onChoose={(next) => choose(item, next)}
              onAdd={() => void addOne(item)}
            />
          ))}
        </ol>

        <div className="mt-2 border-t border-ink pt-5">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm font-semibold">{t("look.completeLook")}</span>
            <span className="flex flex-wrap items-baseline justify-end gap-x-2" dir="ltr">
              <span className="text-xl font-bold">{money(total)}</span>
              {fullPrice > total && <s className="text-xs text-stone">{money(fullPrice)}</s>}
            </span>
          </div>
          {fullPrice > total && (
            <p className="mt-1 text-end text-xs text-gold-deep">{t("look.savings", { amount: money(fullPrice - total) })}</p>
          )}
          {pieces.length < look.items.length && <p className="mt-2 text-xs text-stone">{t("look.unavailableSkip")}</p>}
          <button
            type="button"
            onClick={() => void addAll()}
            disabled={pieces.length === 0 || busy !== null}
            className="btn btn-primary mt-5 h-14 w-full"
          >
            {busy === "all" ? t("look.adding") : t("look.addComplete")}
            {busy !== "all" && pieces.length > 0 && (
              <>
                {" "}· <span dir="ltr">{money(total)}</span>
              </>
            )}
          </button>
          <p className="mt-3 min-h-5 text-sm" role="status" aria-live="polite">
            {notice?.kind === "all" && <BagLink text={t("look.addedAll")} />}
            {notice?.kind === "one" && <BagLink text={t("look.addedOne", { name: notice.name })} />}
            {notice?.kind === "some" && <BagLink text={t("look.addedSome", { added: notice.added, total: notice.total })} />}
            {notice?.kind === "sizes" && <span className="text-danger">{t("look.chooseSizes")}</span>}
            {notice?.kind === "error" && <span className="text-danger">{notice.message}</span>}
          </p>
        </div>
      </section>
    </div>
  );
}

function BagLink({ text }: { text: string }) {
  const { t, href } = useT();
  return (
    <>
      {text}{" "}
      <Link to={href("/bag")} className="font-semibold underline">
        {t("product.viewBag")}
      </Link>
    </>
  );
}

function LookPiece({
  item,
  index,
  choice,
  needsSize,
  busy,
  disabled,
  onChoose,
  onAdd,
}: {
  item: LookItem;
  index: number;
  choice: Choice;
  needsSize: boolean;
  busy: boolean;
  disabled: boolean;
  onChoose: (next: Partial<Choice>) => void;
  onAdd: () => void;
}) {
  const { t, href, pick, money } = useT();
  const color = colorOf(item, choice.colorId);
  const name = pick(item, "name");
  const variants = color?.variants ?? [];
  const available = variants.some((v) => v.available);
  const productHref = href(`/product/${item.productSlug}`);
  const details = [pick(item, "fabric"), pick(item, "fit")].filter(Boolean);

  return (
    <li
      id={`look-item-${item.productSlug}`}
      className="look-piece grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 py-5 sm:grid-cols-[6.5rem_minmax(0,1fr)]"
      style={{ "--i": index } as CSSProperties}
    >
      <Link to={productHref} className="block self-start overflow-hidden bg-studio" tabIndex={-1} aria-hidden="true">
        <ProductPhoto url={color?.imageUrl} alt="" sizes="104px" className="aspect-[4/5] w-full transition-transform duration-700 hover:scale-[1.04]" />
      </Link>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-stone">
              {pick(item, "category")} · {t(`look.role.${item.role}`)}
            </p>
            <h4 className="mt-0.5 text-sm font-medium">
              <Link to={productHref} className="hover:underline">
                {name}
              </Link>
            </h4>
          </div>
          <Price price={item.price} salePrice={item.salePrice} />
        </div>

        {item.colors.length > 0 && (
          <fieldset className="mt-3">
            <legend className="text-xs">
              <span className="font-semibold">{t("product.colour")}:</span> {color ? pick(color, "name") : ""}
              {color?.id === item.colorId && (
                <span className="ms-2 inline-flex items-center gap-1 text-stone">
                  <span aria-hidden="true" className="h-1 w-1 rounded-full bg-gold" />
                  {t("look.inPhoto")}
                </span>
              )}
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {item.colors.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onChoose({ colorId: c.id, variantId: null })}
                  aria-pressed={c.id === color?.id}
                  aria-label={pick(c, "name")}
                  title={pick(c, "name")}
                  className={`h-6 w-6 cursor-pointer rounded-full border border-line ring-offset-2 ring-offset-paper ${c.id === color?.id ? "ring-1 ring-ink" : ""}`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </fieldset>
        )}

        {available ? (
          <fieldset className="mt-3">
            <legend className={`text-xs ${needsSize ? "text-danger" : ""}`}>
              <span className="font-semibold">{t("product.size")}:</span>{" "}
              <span dir="ltr">{variants.find((v) => v.id === choice.variantId)?.sizeCode ?? t("look.needsSize")}</span>
            </legend>
            <div className={`mt-2 flex flex-wrap gap-1.5 ${needsSize ? "look-needs-size" : ""}`}>
              {variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  disabled={!v.available}
                  onClick={() => onChoose({ variantId: v.id })}
                  aria-pressed={v.id === choice.variantId}
                  aria-label={v.available ? v.sizeCode : t("product.soldOutSize", { size: v.sizeCode })}
                  dir="ltr"
                  className={`h-9 min-w-10 border px-2 text-xs font-semibold transition-colors ${
                    !v.available
                      ? "cursor-not-allowed border-line bg-bone text-stone line-through"
                      : v.id === choice.variantId
                        ? "cursor-pointer border-ink bg-ink text-bone"
                        : `cursor-pointer bg-card hover:border-ink ${needsSize ? "border-danger" : "border-line"}`
                  }`}
                >
                  {v.sizeCode}
                </button>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="mt-3 text-xs text-stone">{t("look.soldOutItem")}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={onAdd}
            disabled={!available || disabled}
            className="label cursor-pointer border-b border-ink pb-0.5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? t("look.adding") : t("look.addItem")}
            {!busy && available && (
              <>
                {" "}· <span dir="ltr">{money(unitPrice(item))}</span>
              </>
            )}
          </button>
          {(details.length > 0 || pick(item, "description")) && (
            <details className="group text-xs text-stone">
              <summary className="cursor-pointer list-none underline-offset-2 hover:text-ink hover:underline">{t("look.details")}</summary>
              <div className="mt-2 space-y-1 leading-relaxed">
                {pick(item, "description") && <p className="line-clamp-4">{pick(item, "description")}</p>}
                {pick(item, "fabric") && (
                  <p>
                    <span className="font-semibold text-ink">{t("product.fabric")}:</span> {pick(item, "fabric")}
                  </p>
                )}
                {pick(item, "fit") && (
                  <p>
                    <span className="font-semibold text-ink">{t("product.fit")}:</span> {pick(item, "fit")}
                  </p>
                )}
                <Link to={productHref} className="inline-block font-semibold text-ink underline">
                  {t("look.viewProduct")}
                </Link>
              </div>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}

/** A look in a grid: the model photo, its name and today's price for the whole outfit. */
export function LookTile({ look, eager }: { look: LookCard; eager?: boolean }) {
  const { t, href, pick, money } = useT();
  return (
    <Link to={href(`/looks/${look.slug}`)} className="group block">
      <div className="overflow-hidden bg-studio">
        <ProductPhoto
          url={look.imageUrl}
          alt={t("look.photoAlt", { title: pick(look, "title") })}
          sizes="(min-width: 1024px) 33vw, 50vw"
          eager={eager}
          className="aspect-[2/3] w-full transition-transform duration-[1200ms] ease-[var(--ease-out)] group-hover:scale-[1.03]"
        />
      </div>
      <span aria-hidden="true" className="card-rule block h-px bg-ink" />
      <p className="label mt-3 text-stone">{t("look.pieces", { count: look.itemCount })}</p>
      <h3 className="mt-1 text-sm font-medium">{pick(look, "title")}</h3>
      <p className="mt-1 text-sm font-bold" dir="ltr">
        {money(look.total)}
      </p>
    </Link>
  );
}

/**
 * "Try the look": every look's model standing side by side on one backdrop. Pointing at a model brings
 * it forward; choosing one opens it with everything it wears beside it, and "All looks" returns here.
 */
export function LookLineup({ looks, initial, heading = true }: { looks: LookCard[]; initial?: LookDetail; heading?: boolean }) {
  const { t, pick, money } = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["look", open],
    queryFn: () => api<LookDetail>("GET", `/api/v1/catalog/looks/${encodeURIComponent(open!)}`),
    enabled: open !== null,
    initialData: open && initial?.slug === open ? initial : undefined,
    staleTime: 60_000,
  });

  const choose = (slug: string) => {
    setOpen(slug);
    document.getElementById("try-the-look")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (open && detail.data) {
    return (
      <div id="try-the-look" className="look-focus scroll-mt-24">
        <ShopTheLook key={detail.data.slug} look={detail.data} onBack={() => setOpen(null)} />
      </div>
    );
  }

  return (
    <div id="try-the-look" className="scroll-mt-24">
      <div className={heading ? "flex flex-wrap items-end justify-between gap-4" : "sr-only"}>
        <div>
          <p className="label flex items-center gap-3 text-stone">
            <span aria-hidden="true" className="h-px w-8 bg-gold" />
            {t("look.label")}
          </p>
          <h2 className="display mt-3 text-2xl md:text-3xl">{t("look.tryTitle")}</h2>
        </div>
        <p className="max-w-xs text-sm text-stone">{t("look.tryText")}</p>
      </div>
      <ul
        className={`look-lineup mx-auto mt-8 flex w-fit max-w-full snap-x snap-mandatory items-end overflow-x-auto pb-4 [scrollbar-width:none] ${detail.isFetching ? "look-switching" : ""}`}
        onMouseLeave={() => setHover(null)}
      >
        {looks.map((look, i) => {
          const dimmed = hover !== null && hover !== look.slug;
          return (
            <li
              key={look.slug}
              className={`look-lineup-item shrink-0 snap-center ${dimmed ? "is-dimmed" : ""}`}
              style={{ "--i": i } as CSSProperties}
            >
              <button
                type="button"
                onClick={() => choose(look.slug)}
                onMouseEnter={() => setHover(look.slug)}
                onFocus={() => setHover(look.slug)}
                onBlur={() => setHover(null)}
                className="group block w-full cursor-pointer text-start"
              >
                <span className="look-figure block">
                  <ProductPhoto
                    url={look.imageUrl}
                    alt={t("look.photoAlt", { title: pick(look, "title") })}
                    sizes="(min-width: 1024px) 18vw, 45vw"
                    eager={i < 4}
                    className="aspect-[2/3] w-full"
                  />
                </span>
                <span className="look-lineup-caption mt-2 block text-center">
                  <span className="block text-sm font-medium">{pick(look, "title")}</span>
                  <span className="mt-0.5 block text-xs text-stone">
                    {t("look.pieces", { count: look.itemCount })} · <span dir="ltr">{money(look.total)}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {looks.some((l) => l.aiGenerated) && <p className="mt-2 text-xs text-stone">{t("look.ai")}</p>}
    </div>
  );
}
