import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { Route } from "./+types/order";
import { ProductPhoto } from "~/components/product";
import { useRequireSignIn } from "~/features/auth/session";
import { api, ApiError } from "~/lib/http";
import { toLang, translate, useT, type MessageKey } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";
import type { Order, SiteContent } from "~/lib/types";

export function meta({ params, matches, location }: Route.MetaArgs) {
  const title = translate(toLang(params.lang), "order.title", { reference: params.reference ?? "" });
  return seo({ origin: layoutOrigin(matches), pathname: location.pathname, title, description: title, noindex: true });
}

/** Whatever the customer still has to do, or know, about paying. The server decides; this only shows it. */
function PaymentPanel({ order, autoPay, returned }: { order: Order; autoPay: boolean; returned: boolean }) {
  const { t, money, pick, code } = useT();
  const client = useQueryClient();
  const [reference, setReference] = useState("");
  const [referenceError, setReferenceError] = useState(false);
  const started = useRef(false);
  const base = `/api/v1/orders/${encodeURIComponent(order.reference)}/payment`;

  const site = useQuery({
    queryKey: ["site"],
    queryFn: () => api<SiteContent>("GET", "/api/v1/content/site"),
    staleTime: 300_000,
    enabled: order.paymentAction === "TRANSFER",
  });
  // Card, wallet and Fawry details are entered on Paymob's own page, never here.
  const pay = useMutation({
    mutationFn: () => api<{ redirectUrl: string }>("POST", `${base}/paymob`),
    onSuccess: ({ redirectUrl }) => window.location.assign(redirectUrl),
  });
  const transfer = useMutation({
    mutationFn: () => api<Order>("POST", `${base}/transfer`, { reference: reference.trim() }),
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
    return <p className={box} role="status">{t("pay.transferChecking", { reference: order.transferReference ?? "" })}</p>;
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
      </div>
    );
  }
  if (order.paymentAction === "TRANSFER") {
    return (
      <form
        noValidate
        className={box}
        onSubmit={(e) => {
          e.preventDefault();
          const ok = /^[A-Za-z0-9 ._/-]{4,100}$/.test(reference.trim());
          setReferenceError(!ok);
          if (ok) transfer.mutate();
        }}
      >
        {failed && <p role="alert" className="mb-3 text-danger">{t("pay.transferRejected")}</p>}
        <p>{t("pay.transferTitle", { amount: money(order.total) })}</p>
        <p className="mt-1 text-base font-bold" dir="ltr">{site.data?.instapay?.handle ?? "…"}</p>
        {site.data?.instapay && pick(site.data.instapay, "instructions") && (
          <p className="mt-1 text-xs text-stone">{pick(site.data.instapay, "instructions")}</p>
        )}
        <label htmlFor="transfer-ref" className="mb-1.5 mt-4 block font-medium">{t("pay.transferRef")}</label>
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
            onChange={(e) => setReference(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={transfer.isPending}>{t("pay.transferSubmit")}</button>
        </div>
        {referenceError && <p id="transfer-ref-error" className="mt-1 text-xs text-danger">{t("pay.err.reference")}</p>}
        {transfer.isError && <p role="alert" className="mt-2 text-danger">{error(transfer.error)}</p>}
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
