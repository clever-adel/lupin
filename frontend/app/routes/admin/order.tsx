import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext, useParams } from "react-router";
import type { AdminContext } from "./layout";
import {
  errorText, money, PAYMENT_LABEL, PAYMENT_STATUS_LABEL, STATUS_LABEL, when, type AdminOrder,
} from "~/features/admin/shared";
import { api, ApiError } from "~/lib/http";
import type { OrderStatus } from "~/lib/types";

const ACTION_LABEL: Record<string, string> = {
  CONFIRMED: "Confirm order",
  PROCESSING: "Start preparing",
  SHIPPED: "Mark as shipped",
  DELIVERED: "Mark as delivered",
  CANCELLED: "Cancel order",
};

export default function AdminOrder() {
  const reference = useParams().reference ?? "";
  const client = useQueryClient();
  const key = ["admin", "order", reference];
  const [pending, setPending] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [confirmRefund, setConfirmRefund] = useState(false);
  const { isOwner } = useOutletContext<AdminContext>();

  const query = useQuery({
    queryKey: key,
    queryFn: () => api<AdminOrder>("GET", `/api/v1/admin/orders/${encodeURIComponent(reference)}`),
    retry: false,
  });
  const change = useMutation({
    mutationFn: (status: OrderStatus) =>
      api<AdminOrder>("POST", `/api/v1/admin/orders/${encodeURIComponent(reference)}/status`, {
        status,
        note: note || null,
        carrier: carrier || null,
        trackingReference: tracking || null,
      }),
    onSuccess: (updated) => {
      client.setQueryData(key, updated);
      client.invalidateQueries({ queryKey: ["admin", "orders"] });
      client.invalidateQueries({ queryKey: ["admin", "summary"] });
      setPending(null);
      setNote("");
    },
    onError: () => client.invalidateQueries({ queryKey: key }),
  });

  const refund = useMutation({
    mutationFn: () => api<AdminOrder>("POST", `/api/v1/admin/orders/${encodeURIComponent(reference)}/refunded`, {}),
    onSuccess: (updated) => {
      client.setQueryData(key, updated);
      client.invalidateQueries({ queryKey: ["admin", "summary"] });
      setConfirmRefund(false);
    },
  });

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return <p className="text-danger" role="alert">{notFound ? "There is no order with this reference." : "Could not load the order."}</p>;
  }
  if (!query.data) return <p className="text-stone" aria-busy="true">Loading…</p>;

  const { order: o, payments, shipment, history, nextStatuses, customerEmail } = query.data;
  const heading = "border-b border-line pb-2 text-sm font-semibold";
  const cashDue = o.paymentMethod === "COD" && o.paymentStatus !== "PAID";

  return (
    <div className="max-w-5xl">
      <Link to="/admin" className="text-sm underline">← All orders</Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="display text-2xl">{o.reference}</h1>
        <span className="border border-ink px-3 py-1 text-xs font-semibold uppercase tracking-wide">{STATUS_LABEL[o.status]}</span>
      </div>
      <p className="mt-1 text-sm text-stone">Placed {when(o.placedAt)}</p>

      {o.paymentStatus === "REFUND_PENDING" && (
        <div className="mt-4 border border-danger bg-card px-3 py-3 text-sm" role="alert">
          <p className="text-danger">
            This order has been paid and is cancelled. The customer must be refunded {money(o.total)} by hand.
          </p>
          {refund.isError && <p className="mt-2 text-danger">{errorText(refund.error)}</p>}
          {!isOwner ? (
            <p className="mt-2 text-stone">Only the owner can record that the refund was made.</p>
          ) : confirmRefund ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="font-semibold">Has {money(o.total)} really been sent back to the customer?</span>
              <button type="button" className="btn btn-primary" disabled={refund.isPending} onClick={() => refund.mutate()}>Yes, refund is done</button>
              <button type="button" className="btn btn-outline" disabled={refund.isPending} onClick={() => setConfirmRefund(false)}>Back</button>
            </div>
          ) : (
            <button type="button" className="btn btn-outline mt-3" onClick={() => setConfirmRefund(true)}>Refund has been made</button>
          )}
        </div>
      )}
      {o.paymentStatus === "REFUNDED" && (
        <p className="mt-4 border border-line bg-card px-3 py-2 text-sm">The customer has been refunded.</p>
      )}
      {o.paymentStatus === "VERIFYING" && (
        <p className="mt-4 border border-ink bg-card px-3 py-2 text-sm">
          The customer says they sent an InstaPay transfer. <Link to="/admin/transfers" className="underline">Check it</Link> before doing anything else.
        </p>
      )}

      <section className="mt-6 border border-line bg-card p-4" aria-labelledby="next-title">
        <h2 id="next-title" className="text-sm font-semibold">Next step</h2>
        {change.isError && <p role="alert" className="mt-2 text-sm text-danger">{errorText(change.error)}</p>}
        {nextStatuses.length === 0 ? (
          <p className="mt-2 text-sm text-stone">Nothing more to do on this order.</p>
        ) : pending === null ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {nextStatuses.map((s) => (
              <button key={s} type="button" className={s === "CANCELLED" ? "btn btn-outline" : "btn btn-primary"} onClick={() => setPending(s)}>
                {ACTION_LABEL[s]}
              </button>
            ))}
          </div>
        ) : (
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate(pending);
            }}
          >
            <p className="text-sm font-semibold">
              {ACTION_LABEL[pending]}?
              {pending === "SHIPPED" && " The items leave the stock count now."}
              {pending === "DELIVERED" && cashDue && ` This records ${money(o.total)} cash as collected.`}
              {pending === "CANCELLED" && " The items go back on sale. This cannot be undone."}
              {pending === "CANCELLED" && o.paymentStatus === "PAID" && " The customer has paid and will need a refund."}
            </p>
            {pending === "SHIPPED" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="carrier" className="mb-1.5 block text-sm font-medium">Courier (optional)</label>
                  <input id="carrier" className="field" maxLength={60} value={carrier} onChange={(e) => setCarrier(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="tracking" className="mb-1.5 block text-sm font-medium">Tracking number (optional)</label>
                  <input id="tracking" className="field" maxLength={100} value={tracking} onChange={(e) => setTracking(e.target.value)} />
                </div>
              </div>
            )}
            <div>
              <label htmlFor="note" className="mb-1.5 block text-sm font-medium">Note for staff (optional)</label>
              <input id="note" className="field" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={change.isPending}>
                {change.isPending ? "Saving…" : "Yes, do it"}
              </button>
              <button type="button" className="btn btn-outline" disabled={change.isPending} onClick={() => setPending(null)}>Back</button>
            </div>
          </form>
        )}
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="items-title">
          <h2 id="items-title" className={heading}>Items to pack</h2>
          <ul>
            {o.items.map((item, i) => (
              <li key={i} className="flex justify-between gap-4 border-b border-line py-3 text-sm">
                <span>
                  <span className="font-semibold">{item.quantity} × {item.productNameEn}</span>
                  <span className="block text-xs text-stone">{item.colorEn} · {item.sizeCode} · {money(item.unitPrice)} each</span>
                </span>
                <span className="font-semibold">{money(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="ms-auto max-w-xs space-y-1.5 py-4 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(o.subtotal)}</dd></div>
            {o.discountTotal > 0 && (
              <div className="flex justify-between">
                <dt>Discount{o.promoCode ? ` (${o.promoCode})` : o.discountLabelEn ? ` (${o.discountLabelEn})` : ""}</dt>
                <dd>−{money(o.discountTotal)}</dd>
              </div>
            )}
            <div className="flex justify-between"><dt>Delivery</dt><dd>{money(o.deliveryFee)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Total</dt><dd>{money(o.total)}</dd></div>
          </dl>

          <h2 className={heading}>History</h2>
          <ol className="py-3 text-sm">
            {history.map((h, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-4 py-1.5">
                <span>
                  <span className="font-semibold">{STATUS_LABEL[h.toStatus]}</span>
                  <span className="text-stone"> · {h.actor ?? "System"}</span>
                  {h.note && <span className="block text-xs text-stone">{h.note}</span>}
                </span>
                <time dateTime={h.at} className="text-stone">{when(h.at)}</time>
              </li>
            ))}
          </ol>
        </section>

        <div className="space-y-6 text-sm">
          <section aria-labelledby="customer-title">
            <h2 id="customer-title" className={heading}>Deliver to</h2>
            <address className="space-y-1 py-3 not-italic">
              <p className="font-semibold">{o.customerName}</p>
              <p><a href={`tel:${o.customerPhone}`} className="underline">{o.customerPhone}</a></p>
              {customerEmail && <p className="break-all text-stone">{customerEmail}</p>}
              <p>{o.addressLine}</p>
              <p>{o.city}, {o.governorateEn}</p>
              {o.deliveryNotes && <p className="border-s-2 border-ink ps-2">{o.deliveryNotes}</p>}
              <p className="pt-1 text-stone">{o.deliveryNameEn}{o.deliveryEstimateEn && ` · ${o.deliveryEstimateEn}`}</p>
              {shipment && (
                <p className="text-stone">
                  {shipment.carrier ?? "Courier not recorded"}{shipment.trackingReference && ` · ${shipment.trackingReference}`}
                </p>
              )}
            </address>
          </section>

          <section aria-labelledby="payment-title">
            <h2 id="payment-title" className={heading}>Payment</h2>
            <p className="pt-3">
              {PAYMENT_LABEL[o.paymentMethod ?? ""] ?? "—"} · <span className="font-semibold">{PAYMENT_STATUS_LABEL[o.paymentStatus] ?? o.paymentStatus}</span>
            </p>
            <ul className="py-2 text-xs text-stone">
              {payments.map((p) => (
                <li key={p.id} className="py-1">
                  {when(p.createdAt)} · {p.provider} · {p.status} · {money(p.amount)}
                  {p.transferReference && <span className="block">Transfer ref: {p.transferReference}</span>}
                  {p.providerTransactionId && <span className="block">Paymob transaction: {p.providerTransactionId}</span>}
                </li>
              ))}
              {payments.length === 0 && <li>No payment attempt yet.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
