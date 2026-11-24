import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { errorText, money, when } from "~/features/admin/shared";
import { clampQuantity, linesTotal, normalizeNumber, priceOk } from "~/features/admin/shop";
import { api } from "~/lib/http";
import type { Page } from "~/lib/types";

// Mirrors store.lupinwear.shop.ShopDtos.

interface Piece {
  variantId: number;
  productId: number;
  productName: string;
  productNameAr: string;
  color: string;
  colorHex: string;
  sizeCode: string;
  sku: string;
  onlinePrice: number;
  available: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  imageUrl?: string | null;
}

interface ReceiptLine {
  id: number;
  variantId?: number | null;
  productId?: number | null;
  productName: string;
  color: string;
  sizeCode: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  originalItemId?: number | null;
  returned: number;
  imageUrl?: string | null;
}

interface Receipt {
  id: number;
  kind: "SALE" | "RETURN";
  originalSaleId?: number | null;
  paymentMethod: Method;
  total: number;
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  staffName?: string | null;
  createdAt: string;
  items: ReceiptLine[];
  returnIds: number[];
}

interface Totals {
  sales: number;
  returns: number;
  net: number;
  receipts: number;
  piecesSold: number;
  piecesReturned: number;
}

type Method = "CASH" | "CARD" | "INSTAPAY" | "WALLET";
const METHODS: Record<Method, string> = { CASH: "Cash", CARD: "Card", INSTAPAY: "InstaPay", WALLET: "Wallet" };

/** A line being rung up. For a sale or a free return it names a piece; a receipt return names a receipt line. */
interface Line {
  key: string;
  variantId?: number;
  originalItemId?: number;
  label: string;
  detail: string;
  imageUrl?: string | null;
  /** The most this line may hold: free stock for a sale, what is still out for a receipt return. */
  max?: number;
  quantity: number;
  price: string;
}

function useShopRefresh() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["admin", "shop"] });
    client.invalidateQueries({ queryKey: ["admin", "products"] });
    client.invalidateQueries({ queryKey: ["admin", "summary"] });
  };
}

/** Ignores a second tap on a save button that lands before the first one has disabled it. */
function useOnce() {
  const busy = useRef(false);
  return (run: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    run().finally(() => {
      busy.current = false;
    });
  };
}

/** Search the catalogue and pick a size. Sold-out pieces stay visible for returns. */
function PiecePicker({ mode, onPick, taken }: { mode: "sale" | "return"; onPick: (piece: Piece) => void; taken: (id: number) => number }) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const pieces = useQuery({
    queryKey: ["admin", "shop", "pieces", q],
    queryFn: () => api<Piece[]>("GET", `/api/v1/admin/shop/pieces?q=${encodeURIComponent(q)}`),
    placeholderData: keepPreviousData,
  });

  return (
    <section className="border border-line bg-card p-4" aria-labelledby={`pick-${mode}`}>
      <h2 id={`pick-${mode}`} className="text-sm font-semibold">Choose the piece</h2>
      <label htmlFor={`search-${mode}`} className="sr-only">Product name or SKU</label>
      <input
        id={`search-${mode}`}
        className="field mt-3 w-full"
        placeholder="Search by product name or SKU"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
      />
      <ul className="mt-3 max-h-[28rem] divide-y divide-line overflow-y-auto" aria-busy={pieces.isFetching}>
        {pieces.data?.map((p) => {
          const left = p.available - taken(p.variantId);
          const blocked = mode === "sale" && left <= 0;
          return (
            <li key={p.variantId} className="flex items-center gap-3 py-2">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt="" className="h-12 w-10 shrink-0 bg-paper object-cover" loading="lazy" />
              ) : (
                <span className="h-12 w-10 shrink-0 bg-paper" style={{ backgroundColor: p.colorHex }} aria-hidden />
              )}
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate font-medium">{p.productName}</span>
                <span className="block text-xs text-stone">
                  {p.color} · <strong className="text-ink">{p.sizeCode}</strong> · {p.sku}
                  {p.status === "DRAFT" ? " · hidden online" : p.status === "ARCHIVED" ? " · archived online" : ""}
                </span>
                <span className="block text-xs text-stone">
                  Online {money(p.onlinePrice)} ·{" "}
                  <span className={left <= 0 ? "text-danger" : left <= 2 ? "font-semibold text-danger" : ""}>
                    {left <= 0 ? "none left" : `${left} left`}
                  </span>
                </span>
              </span>
              <button
                type="button"
                className="btn btn-outline h-9 shrink-0"
                disabled={blocked}
                onClick={() => onPick(p)}
                aria-label={`Add ${p.productName} ${p.color} ${p.sizeCode}`}
              >
                Add
              </button>
            </li>
          );
        })}
      </ul>
      {pieces.isPending && <p className="mt-2 text-sm text-stone">Loading…</p>}
      {pieces.isError && <p className="mt-2 text-sm text-danger" role="alert">Could not load the pieces.</p>}
      {pieces.data?.length === 0 && <p className="mt-2 text-sm text-stone">Nothing matches.</p>}
    </section>
  );
}

/** The lines of the receipt being written, with quantity and the price agreed for each piece. */
function Basket({ lines, setLines, priceLabel }: { lines: Line[]; setLines: (fn: (lines: Line[]) => Line[]) => void; priceLabel: string }) {
  const update = (key: string, change: Partial<Line>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...change } : l)));
  if (lines.length === 0) {
    return <p className="border border-dashed border-line p-4 text-sm text-stone">No pieces yet. Add them from the list.</p>;
  }
  return (
    <ul className="divide-y divide-line border border-line bg-card">
      {lines.map((l) => (
        <li key={l.key} className="flex flex-wrap items-center gap-3 p-3">
          {l.imageUrl && <img src={l.imageUrl} alt="" className="h-12 w-10 shrink-0 bg-paper object-cover" />}
          <span className="min-w-[12rem] flex-1 text-sm">
            <span className="block font-medium">{l.label}</span>
            <span className="block text-xs text-stone">{l.detail}</span>
          </span>
          <span className="flex items-center gap-1" role="group" aria-label={`Quantity of ${l.label}`}>
            <button type="button" className="btn btn-outline h-9 w-9 px-0" disabled={l.quantity <= 1} onClick={() => update(l.key, { quantity: clampQuantity(l.quantity - 1, l.max) })} aria-label="One less">−</button>
            <input
              className="field h-9 w-14 px-1 text-center font-semibold"
              inputMode="numeric"
              aria-label={`How many ${l.label}`}
              value={l.quantity}
              onChange={(e) => {
                const n = Number(normalizeNumber(e.target.value));
                if (e.target.value.trim() !== "" && Number.isFinite(n)) update(l.key, { quantity: clampQuantity(n, l.max) });
              }}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className="btn btn-outline h-9 w-9 px-0"
              disabled={l.max !== undefined && l.quantity >= l.max}
              onClick={() => update(l.key, { quantity: clampQuantity(l.quantity + 1, l.max) })}
              aria-label="One more"
            >
              +
            </button>
          </span>
          <label className="text-xs">
            {priceLabel}
            <input
              className={`field mt-1 block h-9 w-28 ${priceOk(l.price) ? "" : "border-danger"}`}
              inputMode="decimal"
              value={l.price}
              onChange={(e) => update(l.key, { price: normalizeNumber(e.target.value) })}
            />
          </label>
          <span className="w-28 text-end text-sm font-semibold">{priceOk(l.price) ? money(linesTotal([l])) : "—"}</span>
          <button type="button" className="cursor-pointer text-sm text-danger underline" onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}>
            Remove <span className="sr-only">{l.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MethodPicker({ value, onChange, legend }: { value: Method; onChange: (m: Method) => void; legend: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(METHODS) as Method[]).map((m) => (
          <label key={m} className={`btn h-9 cursor-pointer ${value === m ? "btn-primary" : "btn-outline"}`}>
            <input type="radio" name={legend} className="sr-only" checked={value === m} onChange={() => onChange(m)} />
            {METHODS[m]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function pieceLine(p: Piece, price?: number): Line {
  return {
    key: `v${p.variantId}`,
    variantId: p.variantId,
    label: p.productName,
    detail: `${p.color} · ${p.sizeCode} · ${p.sku}`,
    imageUrl: p.imageUrl,
    max: p.available,
    quantity: 1,
    price: String(price ?? p.onlinePrice),
  };
}

function Done({ receipt, onAgain }: { receipt: Receipt; onAgain: () => void }) {
  return (
    <div role="status" className="border border-line bg-card p-5">
      <p className="text-lg font-semibold">
        {receipt.kind === "SALE" ? "Sale saved" : "Return saved"} · receipt #{receipt.id}
      </p>
      <p className="mt-1 text-sm text-stone">
        {receipt.items.reduce((n, l) => n + l.quantity, 0)} piece(s), {money(receipt.total)} {receipt.kind === "SALE" ? "taken" : "given back"} by{" "}
        {METHODS[receipt.paymentMethod]}. Stock is {receipt.kind === "SALE" ? "lower" : "back up"} already.
      </p>
      <button type="button" className="btn btn-primary mt-4" onClick={onAgain}>
        {receipt.kind === "SALE" ? "New sale" : "Another return"}
      </button>
    </div>
  );
}

function NewSale() {
  const refresh = useShopRefresh();
  const [lines, setLinesState] = useState<Line[]>([]);
  const setLines = (fn: (lines: Line[]) => Line[]) => setLinesState(fn);
  const [method, setMethod] = useState<Method>("CASH");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [note, setNote] = useState("");
  const once = useOnce();
  const sell = useMutation({
    mutationFn: () =>
      api<Receipt>("POST", "/api/v1/admin/shop/sales", {
        paymentMethod: method,
        customerName,
        customerPhone,
        note,
        items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitPrice: Number(l.price) })),
      }),
    onSuccess: refresh,
  });

  const reset = () => {
    setLinesState([]);
    setMethod("CASH");
    setCustomerName("");
    setCustomerPhone("");
    setNote("");
    sell.reset();
  };
  if (sell.data) return <Done receipt={sell.data} onAgain={reset} />;

  const add = (p: Piece) =>
    setLines((all) => {
      const found = all.find((l) => l.variantId === p.variantId);
      if (found) return all.map((l) => (l === found ? { ...l, quantity: Math.min(l.quantity + 1, p.available) } : l));
      return [...all, pieceLine(p)];
    });
  const ready = lines.length > 0 && lines.every((l) => priceOk(l.price));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <PiecePicker mode="sale" onPick={add} taken={(id) => lines.find((l) => l.variantId === id)?.quantity ?? 0} />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) once(() => sell.mutateAsync().catch(() => undefined));
        }}
      >
        <h2 className="text-sm font-semibold">This sale</h2>
        <Basket lines={lines} setLines={setLines} priceLabel="Shop price (each)" />
        <MethodPicker value={method} onChange={setMethod} legend="Paid by" />
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            Customer name <span className="text-stone">(optional)</span>
            <input className="field mt-1 block w-56" maxLength={120} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </label>
          <label className="text-sm">
            Phone <span className="text-stone">(optional)</span>
            <input className="field mt-1 block w-44" inputMode="tel" maxLength={30} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">
          Note <span className="text-stone">(optional)</span>
          <input className="field mt-1 w-full" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-lg">
            Total <strong>{money(linesTotal(lines))}</strong>
          </span>
          <button type="submit" className="btn btn-primary" disabled={!ready || sell.isPending}>
            {sell.isPending ? "Saving…" : "Complete sale"}
          </button>
        </div>
        {sell.isError && <p role="alert" className="text-sm text-danger">{errorText(sell.error)}</p>}
      </form>
    </div>
  );
}

/** Return lines of an earlier receipt (by its number), or pieces sold before the shop was on the dashboard. */
function NewReturn({ receiptId, setReceiptId }: { receiptId: string; setReceiptId: (id: string) => void }) {
  const refresh = useShopRefresh();
  const [lines, setLinesState] = useState<Line[]>([]);
  const setLines = (fn: (lines: Line[]) => Line[]) => setLinesState(fn);
  const [method, setMethod] = useState<Method>("CASH");
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState(receiptId);
  useEffect(() => setTyped(receiptId), [receiptId]);

  const original = useQuery({
    queryKey: ["admin", "shop", "receipt", receiptId],
    queryFn: () => api<Receipt>("GET", `/api/v1/admin/shop/sales/${receiptId}`),
    enabled: /^\d+$/.test(receiptId),
    retry: false,
    // Coming back to the tab must not reload the receipt under lines staff are still choosing.
    refetchOnWindowFocus: false,
  });
  const fromReceipt = Boolean(receiptId);
  const badNumber = fromReceipt && !/^\d+$/.test(receiptId);
  // A different receipt (or none) starts the return afresh; the money goes back the way it came in.
  useEffect(() => setLinesState([]), [receiptId]);
  const methodFor = useRef("");
  useEffect(() => {
    if (original.data && methodFor.current !== receiptId) {
      methodFor.current = receiptId;
      setMethod(original.data.paymentMethod);
    }
  }, [original.data, receiptId]);

  const once = useOnce();
  const giveBack = useMutation({
    mutationFn: () =>
      api<Receipt>("POST", "/api/v1/admin/shop/returns", {
        originalSaleId: fromReceipt ? Number(receiptId) : undefined,
        paymentMethod: method,
        note,
        items: lines.map((l) => ({
          variantId: l.originalItemId ? undefined : l.variantId,
          originalItemId: l.originalItemId,
          quantity: l.quantity,
          unitPrice: Number(l.price),
        })),
      }),
    onSuccess: refresh,
  });
  const reset = () => {
    setLinesState([]);
    setNote("");
    setReceiptId("");
    giveBack.reset();
  };
  if (giveBack.data) return <Done receipt={giveBack.data} onAgain={reset} />;

  const ready = lines.length > 0 && lines.every((l) => priceOk(l.price));
  const sale = original.data?.kind === "SALE" ? original.data : undefined;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-2 border border-line bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setReceiptId(normalizeNumber(typed).replace(/^#/, ""));
          }}
        >
          <label className="text-sm">
            Receipt number
            <input className="field mt-1 block w-36" inputMode="numeric" placeholder="e.g. 12" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-outline">Find</button>
          {fromReceipt && (
            <button type="button" className="cursor-pointer text-sm underline" onClick={() => setReceiptId("")}>
              No receipt
            </button>
          )}
          <p className="basis-full text-xs text-stone">
            Find the sale in Receipts, or type its number. No receipt (sold before the dashboard)? Pick the pieces from the list instead.
          </p>
        </form>

        {badNumber && <p role="alert" className="text-sm text-danger">Type the receipt number in digits, like 12.</p>}
        {fromReceipt && original.isError && <p role="alert" className="text-sm text-danger">No receipt #{receiptId}.</p>}
        {original.data && original.data.kind !== "SALE" && <p role="alert" className="text-sm text-danger">Receipt #{receiptId} is a return, not a sale.</p>}
        {fromReceipt && sale && (
          <section className="border border-line bg-card p-4" aria-labelledby="orig-title">
            <h2 id="orig-title" className="text-sm font-semibold">
              Receipt #{sale.id} · {when(sale.createdAt)} · {money(sale.total)}
            </h2>
            <ul className="mt-2 divide-y divide-line">
              {sale.items.map((it) => {
                const out = it.quantity - it.returned;
                const added = lines.some((l) => l.originalItemId === it.id);
                return (
                  <li key={it.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{it.productName}</span>
                      <span className="block text-xs text-stone">
                        {it.color} · {it.sizeCode} · {it.quantity} × {money(it.unitPrice)}
                        {it.returned > 0 ? ` · ${it.returned} already back` : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-outline h-9"
                      disabled={out <= 0 || added}
                      onClick={() =>
                        setLines((all) => [
                          ...all,
                          {
                            key: `i${it.id}`,
                            originalItemId: it.id,
                            variantId: it.variantId ?? undefined,
                            label: it.productName,
                            detail: `${it.color} · ${it.sizeCode} · sold at ${money(it.unitPrice)}`,
                            imageUrl: it.imageUrl,
                            max: out,
                            quantity: out,
                            price: String(it.unitPrice),
                          },
                        ])
                      }
                    >
                      {out <= 0 ? "All back" : added ? "Added" : "Return"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {!fromReceipt && (
          <PiecePicker
            mode="return"
            taken={() => 0}
            onPick={(p) =>
              setLines((all) => {
                const found = all.find((l) => l.variantId === p.variantId && !l.originalItemId);
                if (found) return all.map((l) => (l === found ? { ...l, quantity: l.quantity + 1 } : l));
                return [...all, { ...pieceLine(p), max: undefined }];
              })
            }
          />
        )}
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) once(() => giveBack.mutateAsync().catch(() => undefined));
        }}
      >
        <h2 className="text-sm font-semibold">This return</h2>
        <Basket lines={lines} setLines={setLines} priceLabel="Money back (each)" />
        <MethodPicker value={method} onChange={setMethod} legend="Money given back by" />
        <label className="block text-sm">
          Reason or note <span className="text-stone">(optional)</span>
          <input className="field mt-1 w-full" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-lg">
            Give back <strong>{money(linesTotal(lines))}</strong>
          </span>
          <button type="submit" className="btn btn-primary" disabled={!ready || giveBack.isPending}>
            {giveBack.isPending ? "Saving…" : "Complete return"}
          </button>
        </div>
        <p className="text-xs text-stone">The pieces go back into stock and can be sold again, here or online.</p>
        {giveBack.isError && <p role="alert" className="text-sm text-danger">{errorText(giveBack.error)}</p>}
      </form>
    </div>
  );
}

function Receipts({ onReturn }: { onReturn: (id: number) => void }) {
  const [day, setDay] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(0);
  const receipts = useQuery({
    queryKey: ["admin", "shop", "receipts", day, kind, page],
    queryFn: () => api<Page<Receipt>>("GET", `/api/v1/admin/shop/sales?page=${page}&day=${day}&kind=${kind}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Day
          <input type="date" className="field mt-1" value={day} onChange={(e) => { setDay(e.target.value); setPage(0); }} />
        </label>
        <label className="text-sm">
          Show
          <select className="field mt-1" value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }}>
            <option value="">Sales and returns</option>
            <option value="SALE">Sales only</option>
            <option value="RETURN">Returns only</option>
          </select>
        </label>
        {(day || kind) && (
          <button type="button" className="btn btn-outline" onClick={() => { setDay(""); setKind(""); setPage(0); }}>Clear</button>
        )}
      </div>

      <ul className="mt-4 space-y-3" aria-busy={receipts.isFetching}>
        {receipts.data?.items.map((r) => {
          const out = r.items.reduce((n, l) => n + l.quantity - l.returned, 0);
          return (
            <li key={r.id} className="border border-line bg-card p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-semibold">#{r.id}</span>
                <span className={`label ${r.kind === "RETURN" ? "text-danger" : ""}`}>{r.kind === "SALE" ? "Sale" : "Return"}</span>
                <span className="text-sm text-stone">{when(r.createdAt)}</span>
                <span className="text-sm text-stone">{METHODS[r.paymentMethod]}</span>
                {r.staffName && <span className="text-sm text-stone">by {r.staffName}</span>}
                <span className={`ms-auto text-lg font-bold ${r.kind === "RETURN" ? "text-danger" : ""}`}>
                  {r.kind === "RETURN" ? "−" : ""}
                  {money(r.total)}
                </span>
              </div>
              <ul className="mt-2 text-sm">
                {r.items.map((l) => (
                  <li key={l.id} className="flex flex-wrap gap-x-2">
                    <span>{l.quantity} × {l.productName}</span>
                    <span className="text-stone">{l.color} · {l.sizeCode}</span>
                    <span className="text-stone">@ {money(l.unitPrice)}</span>
                    {l.returned > 0 && <span className="text-danger">{l.returned} returned</span>}
                  </li>
                ))}
              </ul>
              {(r.customerName || r.customerPhone || r.note || r.originalSaleId || r.returnIds.length > 0) && (
                <p className="mt-2 text-xs text-stone">
                  {[
                    r.customerName,
                    r.customerPhone,
                    r.note,
                    r.originalSaleId ? `Back from receipt #${r.originalSaleId}` : null,
                    r.returnIds.length ? `Returns: ${r.returnIds.map((id) => `#${id}`).join(", ")}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {r.kind === "SALE" && out > 0 && (
                <button type="button" className="btn btn-outline mt-3 h-9" onClick={() => onReturn(r.id)}>
                  Return pieces
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {receipts.isPending && <p className="mt-3 text-sm text-stone">Loading…</p>}
      {receipts.isError && <p className="mt-3 text-sm text-danger" role="alert">Could not load the receipts.</p>}
      {receipts.data?.items.length === 0 && <p className="mt-3 text-sm text-stone">No receipts yet.</p>}
      {receipts.data && receipts.data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button type="button" className="btn btn-outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} of {receipts.data.totalPages}</span>
          <button type="button" className="btn btn-outline" disabled={page + 1 >= receipts.data.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

const TABS = { sale: "New sale", return: "Return", receipts: "Receipts" } as const;
type Tab = keyof typeof TABS;

/**
 * The shop counter. Prices are typed in per piece (the shop does not follow the online prices), and every
 * sale or return changes the same stock the online store sells from.
 */
export default function AdminShop() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = (params.get("tab") as Tab) in TABS ? (params.get("tab") as Tab) : "sale";
  const receiptId = params.get("receipt") ?? "";
  const go = (next: Tab, receipt?: string) => {
    const p = new URLSearchParams();
    if (next !== "sale") p.set("tab", next);
    if (receipt) p.set("receipt", receipt);
    setParams(p);
  };

  const summary = useQuery({
    queryKey: ["admin", "shop", "summary"],
    queryFn: () => api<{ today: Totals; month: Totals }>("GET", "/api/v1/admin/shop/summary"),
  });
  const t = summary.data?.today;
  const m = summary.data?.month;
  const tiles: [string, string, string?][] = [
    ["Sold today", t ? money(t.sales) : "–", t ? `${t.piecesSold} piece(s), ${t.receipts} receipt(s)` : undefined],
    ["Returned today", t ? money(t.returns) : "–", t ? `${t.piecesReturned} piece(s)` : undefined],
    ["Net today", t ? money(t.net) : "–"],
    ["Net this month", m ? money(m.net) : "–", m ? `${m.piecesSold} sold, ${m.piecesReturned} back` : undefined],
  ];

  return (
    <div>
      <h1 className="display text-2xl">Shop</h1>
      <p className="mt-1 text-sm text-stone">Sales and returns at the shop, at the shop’s own prices. Stock updates by itself.</p>

      <ul className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value, sub]) => (
          <li key={label} className="border border-line bg-card p-3">
            <span className="block text-2xl font-bold">{value}</span>
            <span className="block text-xs text-stone">{label}</span>
            {sub && <span className="block text-xs text-stone">{sub}</span>}
          </li>
        ))}
      </ul>

      <div role="tablist" aria-label="Shop" className="mt-6 flex gap-6 border-b border-line">
        {(Object.keys(TABS) as Tab[]).map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            className={`-mb-px cursor-pointer border-b-2 px-1 py-2 text-sm font-semibold ${tab === key ? "border-ink" : "border-transparent text-stone hover:text-ink"}`}
            onClick={() => go(key)}
          >
            {TABS[key]}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-6">
        {tab === "sale" && <NewSale />}
        {tab === "return" && <NewReturn receiptId={receiptId} setReceiptId={(id) => go("return", id)} />}
        {tab === "receipts" && <Receipts onReturn={(id) => go("return", String(id))} />}
      </div>
    </div>
  );
}
