import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useOutletContext, useSearchParams } from "react-router";
import type { AdminContext } from "./layout";
import { money, PAYMENT_LABEL, PAYMENT_STATUS_LABEL, STATUS_LABEL, when, type AdminOrderRow } from "~/features/admin/shared";
import { api } from "~/lib/http";
import type { Page } from "~/lib/types";

const OPEN = ["PENDING", "AWAITING_PAYMENT", "PAID", "CONFIRMED", "PROCESSING", "SHIPPED"];
const ALL = [...OPEN, "DELIVERED", "CANCELLED"];

/** Orders list. Filters live in the address bar so a filtered view can be bookmarked or shared. */
export default function AdminOrders() {
  const { summary } = useOutletContext<AdminContext>();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page")) || 0;

  const orders = useQuery({
    queryKey: ["admin", "orders", status, q, page],
    queryFn: () =>
      api<Page<AdminOrderRow>>(
        "GET",
        `/api/v1/admin/orders?page=${page}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`,
      ),
    placeholderData: keepPreviousData,
  });

  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };

  return (
    <div>
      <h1 className="display text-2xl">Orders</h1>

      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {OPEN.map((s) => (
          <li key={s}>
            <button
              type="button"
              aria-pressed={status === s}
              className={`w-full cursor-pointer border bg-card p-3 text-start ${status === s ? "border-ink" : "border-line"}`}
              onClick={() => set({ status: status === s ? "" : s })}
            >
              <span className="block text-2xl font-bold">{summary?.ordersByStatus[s] ?? "–"}</span>
              <span className="block text-xs text-stone">{STATUS_LABEL[s]}</span>
            </button>
          </li>
        ))}
      </ul>
      {summary && summary.refundsPending > 0 && (
        <p className="mt-3 border border-danger bg-card px-3 py-2 text-sm text-danger" role="alert">
          {summary.refundsPending} order(s) have money to refund. Search for them below and refund the customer.
        </p>
      )}
      {summary && summary.shipmentsNeedingAttention > 0 && (
        <p className="mt-3 border border-danger bg-card px-3 py-2 text-sm text-danger" role="alert">
          {summary.shipmentsNeedingAttention} shipped order(s) have a courier problem (returned, failed attempt, lost or
          waiting for you). Open the Shipped orders to see which.
        </p>
      )}

      <form
        className="mt-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() });
        }}
      >
        <div>
          <label htmlFor="q" className="mb-1.5 block text-sm font-medium">Reference, phone or name</label>
          <input id="q" name="q" defaultValue={q} key={q} className="field w-64" />
        </div>
        <div>
          <label htmlFor="status" className="mb-1.5 block text-sm font-medium">Status</label>
          <select id="status" className="field" value={status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All</option>
            {ALL.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">Search</button>
        {(status || q) && <button type="button" className="btn btn-outline" onClick={() => setParams({})}>Clear</button>}
      </form>

      <div className="mt-5 overflow-x-auto border border-line bg-card" aria-busy={orders.isFetching}>
        <table className="w-full min-w-[46rem] text-start text-sm">
          <thead className="border-b border-line text-xs text-stone">
            <tr>
              {["Order", "Placed", "Customer", "Items", "Total", "Payment", "Status"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 text-start font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.data?.items.map((o) => (
              <tr key={o.reference} className="border-b border-line last:border-0">
                <th scope="row" className="px-3 py-3 text-start font-semibold">
                  <Link to={`/admin/orders/${o.reference}`} className="underline">{o.reference}</Link>
                </th>
                <td className="px-3 py-3 text-stone">{when(o.placedAt)}</td>
                <td className="px-3 py-3">
                  {o.customerName}
                  <span className="block text-xs text-stone">{o.customerPhone} · {o.governorate}</span>
                </td>
                <td className="px-3 py-3">{o.itemCount}</td>
                <td className="px-3 py-3 font-semibold">{money(o.total)}</td>
                <td className="px-3 py-3">
                  {PAYMENT_LABEL[o.paymentMethod ?? ""] ?? "—"}
                  <span className={`block text-xs ${o.paymentStatus === "REFUND_PENDING" || o.paymentStatus === "VERIFYING" ? "font-semibold text-danger" : "text-stone"}`}>
                    {PAYMENT_STATUS_LABEL[o.paymentStatus] ?? o.paymentStatus}
                  </span>
                </td>
                <td className="px-3 py-3">{STATUS_LABEL[o.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.isPending && <p className="p-4 text-sm text-stone">Loading…</p>}
        {orders.isError && <p className="p-4 text-sm text-danger" role="alert">Could not load orders.</p>}
        {orders.data?.items.length === 0 && <p className="p-4 text-sm text-stone">No orders match.</p>}
      </div>

      {orders.data && orders.data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button type="button" className="btn btn-outline" disabled={page === 0} onClick={() => set({ page: String(page - 1) })}>Previous</button>
          <span>Page {page + 1} of {orders.data.totalPages}</span>
          <button type="button" className="btn btn-outline" disabled={page + 1 >= orders.data.totalPages} onClick={() => set({ page: String(page + 1) })}>Next</button>
        </div>
      )}
    </div>
  );
}
