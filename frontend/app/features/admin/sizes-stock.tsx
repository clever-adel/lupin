import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorText, type AdminVariant } from "~/features/admin/shared";
import { StockCell } from "~/features/admin/stock-cell";
import { api } from "~/lib/http";

/**
 * While editing a product: every colour and size with its stock (add or remove pieces right here), and a
 * form to add a size the product is not sold in yet, with starting stock per colour. Shoppers see a new
 * size at once wherever it has stock.
 */
export function SizesAndStock({ productId, sizes, colours, variants, sizeOptions }: {
  productId: number;
  sizes: string[];
  colours: { id: number; nameEn: string }[];
  variants: AdminVariant[];
  /** The shop's sizes in the product's size group (adult or kids), in order. */
  sizeOptions: string[];
}) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ["admin", "product", String(productId)] });
  const missing = sizeOptions.filter((s) => !sizes.includes(s));
  const [size, setSize] = useState("");
  const [stock, setStock] = useState<Record<number, string>>({});

  const add = useMutation({
    mutationFn: () =>
      api<{ variantIds: number[] }>("POST", `/api/v1/admin/products/${productId}/sizes`, {
        sizeCode: size,
        stockByColor: Object.fromEntries(
          colours.map((c) => [c.id, Math.max(0, Math.trunc(Number(stock[c.id] ?? 0)) || 0)]),
        ),
      }),
    onSuccess: async () => {
      setSize("");
      setStock({});
      await refresh();
      await client.invalidateQueries({ queryKey: ["admin", "products"] });
    },
  });

  return (
    <section className="border border-line bg-card p-5">
      <h2 className="font-semibold">Sizes and stock</h2>
      <p className="mt-1 text-sm text-stone">
        Sold in: <strong dir="ltr">{sizes.length ? sizes.join(" · ") : "no sizes yet"}</strong>. Add or remove pieces
        for each colour and size, or add a new size below.
      </p>

      {variants.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-stone">
              <tr>
                <th scope="col" className="pb-1 pe-3 text-start font-medium">Colour · size</th>
                <th scope="col" className="px-3 pb-1 text-start font-medium">On hand</th>
                <th scope="col" className="px-3 pb-1 text-start font-medium">Held for orders</th>
                <th scope="col" className="px-3 pb-1 text-start font-medium">Free to sell</th>
                <th scope="col" className="ps-3 pb-1 text-start font-medium">Add or remove</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => <StockCell key={v.variantId} variant={v} onDone={refresh} />)}
            </tbody>
          </table>
        </div>
      )}

      {missing.length > 0 && colours.length > 0 && (
        // Not a <form>: this section sits inside the product edit form, and forms cannot nest.
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">Add a size</h3>
          <div className="mt-2 flex flex-wrap items-end gap-3 text-sm">
            <label>
              <span className="mb-1 block text-xs font-medium">Size</span>
              <select className="field h-10 w-28" value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="">Choose…</option>
                {missing.map((s) => <option key={s} value={s}>{s === "ONE" ? "One size" : s}</option>)}
              </select>
            </label>
            {colours.map((c) => (
              <label key={c.id}>
                <span className="mb-1 block text-xs font-medium">Stock · {c.nameEn}</span>
                <input className="field h-10 w-24" type="number" inputMode="numeric" placeholder="0"
                  value={stock[c.id] ?? ""} onChange={(e) => setStock((m) => ({ ...m, [c.id]: e.target.value }))} />
              </label>
            ))}
            <button type="button" className="btn btn-primary h-10" disabled={!size || add.isPending} onClick={() => add.mutate()}>
              {add.isPending ? "Adding…" : size ? `Add size ${size}` : "Add size"}
            </button>
          </div>
          <p className="mt-2 text-xs text-stone">
            Shoppers see the new size straight away wherever it has stock. Then fill its column in the size chart below.
          </p>
          {add.isError && <p role="alert" className="mt-2 text-sm text-danger">{errorText(add.error)}</p>}
          {add.isSuccess && <p role="status" className="mt-2 text-sm">Size added.</p>}
        </div>
      )}
    </section>
  );
}
