import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useOutletContext } from "react-router";
import type { AdminContext } from "./layout";
import { errorText, money, PAYMENT_LABEL } from "~/features/admin/shared";
import { api } from "~/lib/http";

interface Report {
  from: string;
  to: string;
  totalRevenue: number;
  online: { orders: number; revenue: number; itemsRevenue: number; deliveryFees: number; discounts: number; averageOrder: number; cancelled: number; items: number };
  inStore: { sales: number; returns: number; revenue: number; items: number };
  days: { date: string; orders: number; onlineRevenue: number; shopRevenue: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
  sizes: { size: string; quantity: number }[];
  paymentMethods: { method: string; orders: number; revenue: number }[];
}

/** Today's date in Cairo as YYYY-MM-DD. */
function cairoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "Today", range: () => [cairoToday(), cairoToday()] },
  { label: "Last 7 days", range: () => [shift(cairoToday(), -6), cairoToday()] },
  { label: "Last 30 days", range: () => [shift(cairoToday(), -29), cairoToday()] },
  { label: "This month", range: () => [`${cairoToday().slice(0, 8)}01`, cairoToday()] },
  { label: "Last 90 days", range: () => [shift(cairoToday(), -89), cairoToday()] },
];

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-line bg-card p-4">
      <p className="text-xs text-stone">{label}</p>
      <p className="mt-1 text-xl font-semibold" dir="ltr">{value}</p>
      {sub && <p className="mt-1 text-xs text-stone">{sub}</p>}
    </div>
  );
}

/** Daily sales as simple bars (online on the bottom, in-store stacked on top). */
function DayBars({ days }: { days: Report["days"] }) {
  const max = Math.max(1, ...days.map((d) => d.onlineRevenue + Math.max(0, d.shopRevenue)));
  return (
    <div>
      <div className="flex h-40 items-end gap-px border-b border-line" role="img"
        aria-label={`Daily sales from ${days[0]?.date} to ${days[days.length - 1]?.date}`}>
        {days.map((d) => {
          const online = (d.onlineRevenue / max) * 100;
          const shop = (Math.max(0, d.shopRevenue) / max) * 100;
          return (
            <div key={d.date} className="flex h-full flex-1 flex-col justify-end" title={`${d.date}: ${money(d.onlineRevenue + d.shopRevenue)} (${d.orders} online orders)`}>
              <div className="bg-gold" style={{ height: `${shop}%` }} />
              <div className="bg-ink" style={{ height: `${online}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-stone" dir="ltr">
        <span>{days[0]?.date}</span>
        <span>{days[days.length - 1]?.date}</span>
      </div>
      <p className="mt-2 flex gap-4 text-xs text-stone">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 bg-ink" /> Online</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 bg-gold" /> In the shop</span>
      </p>
    </div>
  );
}

/**
 * Sales for the owner: totals, daily bars, best sellers, sizes and payment methods for the chosen days,
 * and the online orders of those days as a spreadsheet.
 */
export default function AdminReports() {
  const { isOwner } = useOutletContext<AdminContext>();
  const [[from, to], setRange] = useState<[string, string]>(() => PRESETS[2]!.range());
  const query = useQuery({
    queryKey: ["admin", "reports", from, to],
    queryFn: () => api<Report>("GET", `/api/v1/admin/reports?from=${from}&to=${to}`),
    placeholderData: keepPreviousData,
    enabled: isOwner,
  });

  if (!isOwner) return <p className="text-stone">Reports are for the owner only.</p>;
  const r = query.data;
  const sizeTotal = r?.sizes.reduce((sum, s) => sum + s.quantity, 0) ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Reports</h1>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => {
          const [a, b] = p.range();
          return (
            <button key={p.label} type="button" onClick={() => setRange([a, b])} aria-pressed={a === from && b === to}
              className={`btn h-9 ${a === from && b === to ? "btn-primary" : "btn-outline"}`}>
              {p.label}
            </button>
          );
        })}
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium">From</span>
          <input type="date" className="field h-9" value={from} max={to} onChange={(e) => e.target.value && setRange([e.target.value, to])} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium">To</span>
          <input type="date" className="field h-9" value={to} min={from} onChange={(e) => e.target.value && setRange([from, e.target.value])} />
        </label>
        <a className="btn btn-outline h-9" href={`/api/v1/admin/reports/orders.csv?from=${from}&to=${to}`} download>
          Download orders (Excel)
        </a>
      </div>

      {query.isError && <p role="alert" className="mt-4 text-danger">{errorText(query.error)}</p>}
      {!r && !query.isError && <p className="mt-4 text-stone" aria-busy="true">Loading…</p>}

      {r && (
        <div className={query.isFetching ? "opacity-60" : ""}>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Total sales" value={money(r.totalRevenue)} sub="Online + in the shop" />
            <Tile label="Online orders" value={String(r.online.orders)} sub={`${money(r.online.revenue)} · ${r.online.items} pieces`} />
            <Tile label="Average order" value={money(r.online.averageOrder)} sub="Online, delivery included" />
            <Tile label="In the shop" value={money(r.inStore.revenue)}
              sub={`${r.inStore.sales} sales${r.inStore.returns ? ` · ${r.inStore.returns} returns` : ""} · ${r.inStore.items} pieces`} />
            <Tile label="Cancelled orders" value={String(r.online.cancelled)}
              sub={r.online.orders + r.online.cancelled > 0
                ? `${Math.round((r.online.cancelled / (r.online.orders + r.online.cancelled)) * 100)}% of orders`
                : undefined} />
            <Tile label="Discounts given" value={money(r.online.discounts)} sub="Offers and promo codes, online" />
            <Tile label="Delivery fees" value={money(r.online.deliveryFees)} sub="Charged to customers" />
            <Tile label="Pieces sold" value={String(r.online.items + r.inStore.items)} sub="Online + in the shop" />
          </div>

          <section className="mt-8 border border-line bg-card p-5" aria-labelledby="days-title">
            <h2 id="days-title" className="font-semibold">Sales by day</h2>
            <div className="mt-4"><DayBars days={r.days} /></div>
          </section>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <section className="border border-line bg-card p-5" aria-labelledby="top-title">
              <h2 id="top-title" className="font-semibold">Best sellers</h2>
              {r.topProducts.length === 0 ? <p className="mt-3 text-sm text-stone">No sales in these days.</p> : (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-xs text-stone">
                    <tr><th scope="col" className="pb-1 text-start font-medium">Piece</th><th scope="col" className="pb-1 text-end font-medium">Pieces</th><th scope="col" className="pb-1 text-end font-medium">Sales</th></tr>
                  </thead>
                  <tbody>
                    {r.topProducts.map((p) => (
                      <tr key={p.name} className="border-t border-line">
                        <td className="py-2 pe-2">{p.name}</td>
                        <td className="py-2 text-end">{p.quantity}</td>
                        <td className="py-2 text-end whitespace-nowrap">{money(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="border border-line bg-card p-5" aria-labelledby="sizes-title">
              <h2 id="sizes-title" className="font-semibold">Sizes sold</h2>
              {r.sizes.length === 0 ? <p className="mt-3 text-sm text-stone">No sales in these days.</p> : (
                <ul className="mt-3 space-y-2 text-sm">
                  {r.sizes.map((s) => (
                    <li key={s.size} className="flex items-center gap-3">
                      <span className="w-12 font-semibold" dir="ltr">{s.size}</span>
                      <span className="h-2.5 flex-1 bg-bone"><span className="block h-full bg-ink" style={{ width: `${(s.quantity / Math.max(1, sizeTotal)) * 100}%` }} /></span>
                      <span className="w-20 text-end text-stone">{s.quantity} · {Math.round((s.quantity / Math.max(1, sizeTotal)) * 100)}%</span>
                    </li>
                  ))}
                </ul>
              )}

              <h2 className="mt-6 font-semibold">Online payment methods</h2>
              {r.paymentMethods.length === 0 ? <p className="mt-3 text-sm text-stone">No online orders in these days.</p> : (
                <ul className="mt-3 space-y-1 text-sm">
                  {r.paymentMethods.map((m) => (
                    <li key={m.method} className="flex justify-between gap-2">
                      <span>{PAYMENT_LABEL[m.method] ?? m.method}</span>
                      <span className="text-stone">{m.orders} orders · {money(m.revenue)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <p className="mt-4 text-xs text-stone">
            Days are Cairo days. Online orders count unless cancelled, refunded or still waiting for an online payment. Shop returns are taken off shop sales.
          </p>
        </div>
      )}
    </div>
  );
}
