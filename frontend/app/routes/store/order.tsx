import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { Route } from "./+types/order";
import { ProductPhoto } from "~/components/product";
import { useRequireSignIn } from "~/features/auth/session";
import { api, ApiError } from "~/lib/http";
import { toLang, translate, useT, type MessageKey } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";
import type { Order, PaymentMethod, SiteContent } from "~/lib/types";

export function meta({ params, matches, location }: Route.MetaArgs) {
  const title = translate(toLang(params.lang), "order.title", { reference: params.reference ?? "" });
  return seo({ origin: layoutOrigin(matches), pathname: location.pathname, title, description: title, noindex: true });
}

const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Phone screenshots are often several MB: redraw the photo at most 1600 px tall/wide as a JPEG, which keeps
 * every number readable and makes the upload quick on mobile data. Falls back to the original file.
 */
async function prepareReceipt(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob && blob.size <= RECEIPT_MAX_BYTES) return blob;
  } catch {
    // Not decodable here: let the server judge the original.
  }
  return RECEIPT_TYPES.includes(file.type) && file.size <= RECEIPT_MAX_BYTES ? file : null;
}

const SWITCHABLE: PaymentMethod[] = ["CARD", "WALLET", "FAWRY", "INSTAPAY_MANUAL", "VODAFONE_CASH_MANUAL"];

/** Until the order is paid (or a transfer is sent for checking), the customer may choose another way to pay. */
function ChangeMethod({ order, site }: { order: Order; site?: SiteContent }) {
  const { t, code } = useT();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const options = SWITCHABLE.filter((m) => site?.paymentMethods[m] === true);
  const change = useMutation({
    mutationFn: (method: PaymentMethod) =>
      api<Order>("POST", `/api/v1/orders/${encodeURIComponent(order.reference)}/payment/method`, { method }),
    onSuccess: (updated) => {
      client.setQueryData(["order", updated.reference], updated);
      setOpen(false);
    },
  });
  if (options.filter((m) => m !== order.paymentMethod).length === 0) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      {!open ? (
        <button type="button" className="text-sm underline" onClick={() => setOpen(true)}>{t("pay.change")}</button>
      ) : (
        <fieldset disabled={change.isPending}>
          <legend className="mb-2 font-medium">{t("pay.changeTitle")}</legend>
          <div className="flex flex-wrap gap-2">
            {options.map((m) => {
              const current = m === order.paymentMethod;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={current}
                  className={current ? "btn btn-primary" : "btn btn-outline"}
                  onClick={() => (current ? setOpen(false) : change.mutate(m))}
                >
                  {t(`pay.${m}` as MessageKey)}
                  {current && <span className="ms-1 text-xs opacity-75">({t("pay.changeCurrent")})</span>}
                </button>
              );
            })}
          </div>
          {change.isPending && <p className="mt-2 text-xs text-stone" role="status">{t("pay.changing")}</p>}
          {change.isError && (
            <p role="alert" className="mt-2 text-danger">
              {code("err", change.error instanceof ApiError ? change.error.code : undefined)}
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}

/** Whatever the customer still has to do, or know, about paying. The server decides; this only shows it. */
/** Copies the InstaPay address or wallet number, so it can be pasted into the payment app. */
function CopyButton({ value }: { value: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex h-8 cursor-pointer items-center gap-1.5 border border-line bg-card px-2.5 text-xs font-semibold hover:border-ink"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard not allowed: the value stays on screen to copy by hand.
        }
      }}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        {copied ? (
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M5.5 5.5V3.2c0-.4.3-.7.7-.7h6.6c.4 0 .7.3.7.7v6.6c0 .4-.3.7-.7.7h-2.3M3.2 5.5h6.6c.4 0 .7.3.7.7v6.6c0 .4-.3.7-.7.7H3.2c-.4 0-.7-.3-.7-.7V6.2c0-.4.3-.7.7-.7z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        )}
      </svg>
      <span role="status">{copied ? t("pay.copied") : t("pay.copy")}</span>
    </button>
  );
}

function PaymentPanel({ order, autoPay, returned }: { order: Order; autoPay: boolean; returned: boolean }) {
  const { t, money, pick, code } = useT();
  const client = useQueryClient();
  const [reference, setReference] = useState("");
  const [referenceError, setReferenceError] = useState(false);
  const [receipt, setReceipt] = useState<Blob | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [proofError, setProofError] = useState(false);
  useEffect(() => () => {
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
  }, [receiptPreview]);
  const started = useRef(false);
  const base = `/api/v1/orders/${encodeURIComponent(order.reference)}/payment`;

  const site = useQuery({
    queryKey: ["site"],
    queryFn: () => api<SiteContent>("GET", "/api/v1/content/site"),
    staleTime: 300_000,
    enabled: order.paymentAction === "TRANSFER" || order.paymentAction === "PAYMOB",
  });
  // Card, wallet and Fawry details are entered on Paymob's own page, never here.
  const pay = useMutation({
    mutationFn: () => api<{ redirectUrl: string }>("POST", `${base}/paymob`),
    onSuccess: ({ redirectUrl }) => window.location.assign(redirectUrl),
  });
  const transfer = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (reference.trim()) form.set("reference", reference.trim());
      if (receipt) form.set("receipt", receipt, "transfer.jpg");
      return api<Order>("POST", `${base}/transfer`, form);
    },
    onSuccess: (updated) => client.setQueryData(["order", updated.reference], updated),
  });
  const { mutate: startPayment } = pay;
  useEffect(() => {
    if (autoPay && order.paymentAction === "PAYMOB" && !started.current) {
      started.current = true;
      startPayment();
    }
  }, [autoPay, order.paymentAction, startPayment]);

  const box = "mt-6 border border-line bg-card p-4 text-sm";
  const failed = order.paymentStatus === "FAILED";
  const error = (e: unknown) => code("err", e instanceof ApiError ? e.code : undefined);

  if (order.paymentStatus === "REFUND_PENDING") {
    return <p className={`${box} text-danger`} role="alert">{t("pay.refundPending")}</p>;
  }
  if (order.paymentStatus === "VERIFYING") {
    return (
      <p className={box} role="status">
        {order.transferReference
          ? t("pay.transferChecking", { reference: order.transferReference })
          : t("pay.transferCheckingReceipt")}
      </p>
    );
  }
  if (order.paymentAction === "PAYMOB") {
    const waiting = returned && !failed;
    return (
      <div className={box}>
        {pay.isError && <p role="alert" className="mb-3 text-danger">{error(pay.error)}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className={failed ? "text-danger" : undefined}>
            {failed ? t("pay.failed") : waiting ? t("pay.confirming") : t("pay.awaiting")}
          </p>
          <button type="button" className={waiting ? "btn btn-outline" : "btn btn-primary"} disabled={pay.isPending || pay.isSuccess} onClick={() => pay.mutate()}>
            {pay.isPending || pay.isSuccess ? t("pay.opening") : `${t("pay.now")} · ${money(order.total)}`}
          </button>
        </div>
        <ChangeMethod order={order} site={site.data} />
      </div>
    );
  }
  if (order.paymentAction === "TRANSFER") {
    // Where the money goes depends on the method chosen at checkout.
    const wallet = order.paymentMethod === "VODAFONE_CASH_MANUAL";
    const destination = wallet ? site.data?.vodafoneCash : site.data?.instapay;
    const destinationValue = wallet ? site.data?.vodafoneCash?.number : site.data?.instapay?.handle;
    return (
      <form
        noValidate
        className={box}
        onSubmit={(e) => {
          e.preventDefault();
          const typed = reference.trim();
          const badReference = typed !== "" && !/^[A-Za-z0-9 ._/-]{4,100}$/.test(typed);
          const nothing = typed === "" && !receipt;
          setReferenceError(badReference);
          setProofError(nothing);
          if (!badReference && !nothing && !preparing) transfer.mutate();
        }}
      >
        {failed && <p role="alert" className="mb-3 text-danger">{t("pay.transferRejected")}</p>}
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div>
            <p>{t(wallet ? "pay.vodafoneTitle" : "pay.transferTitle", { amount: money(order.total) })}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-lg font-bold" dir="ltr">{destinationValue ?? "…"}</p>
              {destinationValue && <CopyButton value={destinationValue} />}
            </div>
            {destination && pick(destination, "instructions") && (
              <p className="mt-1 text-xs text-stone">{pick(destination, "instructions")}</p>
            )}
            {/* InstaPay's own link opens the app with the address filled in. */}
            {!wallet && site.data?.instapay?.link && (
              <a href={site.data.instapay.link} target="_blank" rel="noopener noreferrer" className="btn btn-primary mt-4">
                {t("pay.openInstapay")}
              </a>
            )}
          </div>
          {/* Large enough to scan from another phone; on a phone it can be saved and scanned from InstaPay. */}
          {!wallet && site.data?.instapay?.qrUrl && (
            <figure className="justify-self-center border border-line bg-white p-3 text-center md:justify-self-end">
              <img src={site.data.instapay.qrUrl} alt="InstaPay QR" width={220} height={236} className="mx-auto h-auto w-[220px] max-w-full object-contain" />
              <figcaption className="mt-2 max-w-[220px] text-xs text-stone">{t("pay.scanQr")}</figcaption>
            </figure>
          )}
        </div>
        <p className="mt-5 font-medium">{t("pay.receipt")}</p>
        <p className="mt-0.5 text-xs text-stone">{t("pay.receiptHint")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {receiptPreview && (
            <img src={receiptPreview} alt={t("pay.receipt")} className="h-24 w-auto max-w-[8rem] border border-line bg-white object-contain" />
          )}
          <label className="btn btn-outline cursor-pointer">
            {preparing ? t("pay.receiptPreparing") : t("pay.receiptChoose")}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setPreparing(true);
                const prepared = await prepareReceipt(file);
                setPreparing(false);
                setReceiptError(!prepared);
                setProofError(false);
                setReceipt(prepared);
                setReceiptPreview(prepared ? URL.createObjectURL(prepared) : null);
              }}
            />
          </label>
          {receipt && (
            <button
              type="button"
              className="text-xs underline"
              onClick={() => {
                setReceipt(null);
                setReceiptPreview(null);
              }}
            >
              {t("pay.receiptRemove")}
            </button>
          )}
        </div>
        {receiptError && <p className="mt-1 text-xs text-danger" role="alert">{t("pay.err.receiptType")}</p>}
        <label htmlFor="transfer-ref" className="mb-1.5 mt-4 block font-medium">{t("pay.transferRefOptional")}</label>
        <div className="flex flex-wrap gap-2">
          <input
            id="transfer-ref"
            className="field min-w-0 flex-1"
            dir="ltr"
            maxLength={100}
            autoComplete="off"
            value={reference}
            aria-invalid={referenceError || undefined}
            aria-describedby={referenceError ? "transfer-ref-error" : undefined}
            onChange={(e) => {
              setReference(e.target.value);
              setProofError(false);
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={transfer.isPending || preparing}>{t("pay.transferSubmit")}</button>
        </div>
        {referenceError && (
          <p id="transfer-ref-error" className="mt-1 text-xs text-danger">{t(wallet ? "pay.err.referenceWallet" : "pay.err.reference")}</p>
        )}
        {proofError && <p role="alert" className="mt-2 text-danger">{t("pay.err.proof")}</p>}
        {transfer.isError && <p role="alert" className="mt-2 text-danger">{error(transfer.error)}</p>}
        <ChangeMethod order={order} site={site.data} />
      </form>
    );
  }
  return null;
}

/** Private page: the order is fetched in the browser with the session cookie, never server-rendered. */
export default function OrderPage() {
  const { t, href, pick, money, code, dateTime, lang } = useT();
  const reference = useParams().reference ?? "";
  const [search] = useSearchParams();
  const me = useRequireSignIn(href("/sign-in"));
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const returned = search.get("payment") === "return";

  const order = useQuery({
    queryKey: ["order", reference],
    queryFn: () => api<Order>("GET", `/api/v1/orders/${encodeURIComponent(reference)}`),
    enabled: Boolean(me.data),
    retry: false,
    // Back from Paymob: the redirect itself proves nothing, so wait for the server to hear from Paymob.
    refetchInterval: (query) =>
      returned && query.state.data?.status === "AWAITING_PAYMENT" && query.state.dataUpdateCount < 40 ? 3000 : false,
  });

  const act = useMutation({
    mutationFn: (action: "cancel" | "undo-cancel") =>
      api<Order>("POST", `/api/v1/orders/${encodeURIComponent(reference)}/${action}`),
    onSuccess: (updated) => {
      setConfirming(false);
      client.setQueryData(["order", reference], updated);
      client.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: () => client.invalidateQueries({ queryKey: ["order", reference] }),
  });

  if (order.isError) {
    const notFound = order.error instanceof ApiError && order.error.status === 404;
    return (
      <div className="shell py-20 text-center">
        <p className="text-danger" role="alert">{notFound ? t("order.notFound") : t("error.generic")}</p>
        <Link to={href("/account")} className="btn btn-outline mt-6">{t("order.back")}</Link>
      </div>
    );
  }
  if (!order.data) {
    return <p className="shell py-20 text-stone" aria-busy="true">{t("auth.working")}</p>;
  }

  const o = order.data;
  const failure = act.error instanceof ApiError ? act.error : null;
  const heading = "border-b border-line pb-3 text-sm font-semibold";
  const status = (value: string) => t(`order.status.${value}` as MessageKey);

  return (
    <div className="shell max-w-3xl pt-10">
      {search.get("placed") === "1" && o.status !== "CANCELLED" && (
        <p role="status" className="mb-6 border border-ink bg-card px-4 py-3 text-sm font-semibold">{t("order.placed")}</p>
      )}

      <p className="label text-stone">{t("order.placedOn", { date: dateTime(o.placedAt) })}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
        <h1 className="display text-3xl">
          {t("order.title", { reference: "" })}
          <span dir="ltr">{o.reference}</span>
        </h1>
        <span className="border border-ink px-3 py-1 text-xs font-semibold uppercase tracking-wide">{status(o.status)}</span>
      </div>

      <PaymentPanel order={o} autoPay={search.get("pay") === "1"} returned={returned} />

      {(o.canCancel || o.canUndo || act.isError) && (
        <div className="mt-6 border border-line bg-card p-4 text-sm">
          {act.isError && <p role="alert" className="mb-3 text-danger">{code("err", failure?.code)}</p>}
          {o.canUndo && o.undoExpiresAt && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>{t("order.undoUntil", { time: dateTime(o.undoExpiresAt) })}</p>
              <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate("undo-cancel")}>
                {t("order.undo")}
              </button>
            </div>
          )}
          {o.canCancel &&
            (confirming ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold">{t("order.cancelAsk")}</p>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-outline" disabled={act.isPending} onClick={() => setConfirming(false)}>
                    {t("order.keep")}
                  </button>
                  <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate("cancel")}>
                    {t("order.cancelConfirm")}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="cursor-pointer underline" onClick={() => setConfirming(true)}>
                {t("order.cancel")}
              </button>
            ))}
        </div>
      )}

      <section className="mt-10" aria-labelledby="items-title">
        <h2 id="items-title" className={heading}>{t("order.items")}</h2>
        <ul>
          {o.items.map((item, i) => (
            <li key={i} className="flex gap-4 border-b border-line py-4">
              <ProductPhoto url={item.imageUrl} alt="" sizes="64px" className="h-20 w-16 shrink-0" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">{pick(item, "productName")}</p>
                <p className="mt-0.5 text-xs text-stone">
                  {pick(item, "color")} · <span dir="ltr">{item.sizeCode}</span> · {t("checkout.qty", { count: item.quantity })}
                </p>
                <p className="mt-0.5 text-xs text-stone">{t("bag.each", { price: money(item.unitPrice) })}</p>
              </div>
              <span className="shrink-0 text-sm font-bold">{money(item.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="ms-auto max-w-xs space-y-2 py-4 text-sm">
          <div className="flex justify-between">
            <dt>{t("bag.subtotal")}</dt>
            <dd>{money(o.subtotal)}</dd>
          </div>
          {o.discountTotal > 0 && (
            <div className="flex justify-between gap-3">
              <dt>
                {t("checkout.discount")}
                {pick(o, "discountLabel") && <span className="block text-xs text-stone">{pick(o, "discountLabel")}</span>}
              </dt>
              <dd>−{money(o.discountTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt>{t("checkout.deliveryFee")}</dt>
            <dd>{o.deliveryFee === 0 ? t("checkout.free") : money(o.deliveryFee)}</dd>
          </div>
          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <dt className="font-semibold">{t("checkout.total")}</dt>
            <dd className="text-lg font-bold">{money(o.total)}</dd>
          </div>
        </dl>
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <section aria-labelledby="deliver-title">
          <h2 id="deliver-title" className={heading}>{t("order.deliverTo")}</h2>
          <address className="space-y-1 py-4 text-sm not-italic">
            <p>{o.customerName}</p>
            <p dir="ltr" className="text-start">{o.customerPhone}</p>
            <p>{o.addressLine}</p>
            <p>{o.city}{lang === "ar" ? "،" : ","} {pick(o, "governorate")}</p>
            {o.deliveryNotes && <p className="text-stone">{o.deliveryNotes}</p>}
            <p className="pt-2 text-stone">
              {pick(o, "deliveryName")}
              {pick(o, "deliveryEstimate") && ` · ${pick(o, "deliveryEstimate")}`}
            </p>
            {o.paymentMethod && <p className="text-stone">{t(`pay.${o.paymentMethod}`)}</p>}
            {o.carrier && <p className="pt-2">{t("order.courier", { carrier: o.carrier })}</p>}
            {o.trackingNumber && (
              <p className="font-semibold">
                {t("order.trackingNumber", { tracking: "" })}<span dir="ltr">{o.trackingNumber}</span>
              </p>
            )}
          </address>
        </section>

        <section aria-labelledby="history-title">
          <h2 id="history-title" className={heading}>{t("order.history")}</h2>
          <ol className="space-y-2 py-4 text-sm">
            {o.history.map((entry, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className={i === o.history.length - 1 ? "font-semibold" : undefined}>{status(entry.status)}</span>
                <time dateTime={entry.at} className="text-stone">{dateTime(entry.at)}</time>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <Link to={href("/account")} className="mt-6 inline-block text-sm underline">{t("order.back")}</Link>
    </div>
  );
}
