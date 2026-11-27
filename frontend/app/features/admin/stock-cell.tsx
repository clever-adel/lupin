import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { errorText, type AdminVariant } from "~/features/admin/shared";
import { api } from "~/lib/http";

/** One colour and size: on hand, held for orders, free to sell, and buttons to add or remove pieces. */
export function StockCell({ variant, onDone }: { variant: AdminVariant; onDone: () => void }) {
  const [delta, setDelta] = useState("");
  const adjust = useMutation({
    mutationFn: (amount: number) =>
      api("POST", `/api/v1/admin/inventory/${variant.variantId}/adjust`, { delta: amount, note: "Dashboard adjustment" }),
    onSuccess: () => {
      setDelta("");
      onDone();
    },
  });
  const amount = Number(delta);
  const valid = delta.trim() !== "" && Number.isInteger(amount) && amount !== 0;
  const id = `adj-${variant.variantId}`;

  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-2 pe-3 text-start font-normal">
        {variant.color} · {variant.sizeCode}
        <span className="block text-xs text-stone">{variant.sku}</span>
      </th>
      <td className="px-3 py-2">{variant.onHand}</td>
      <td className="px-3 py-2">{variant.reserved}</td>
      <td className={`px-3 py-2 font-semibold ${variant.available <= 2 ? "text-danger" : ""}`}>{variant.available}</td>
      <td className="py-2 ps-3">
        {/* Not a <form>: this row also sits inside the product edit form, and forms cannot nest. */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-outline h-9 w-11 px-0 text-base"
            aria-label={`−1: remove one ${variant.color} ${variant.sizeCode}`}
            title="Remove one piece"
            disabled={adjust.isPending || variant.available <= 0}
            onClick={() => adjust.mutate(-1)}
          >
            −1
          </button>
          <button
            type="button"
            className="btn btn-primary h-9 w-11 px-0 text-base"
            aria-label={`+1: add one ${variant.color} ${variant.sizeCode}`}
            title="Add one piece"
            disabled={adjust.isPending}
            onClick={() => adjust.mutate(1)}
          >
            +1
          </button>
          <label htmlFor={id} className="sr-only">Add or remove stock for {variant.color} {variant.sizeCode}</label>
          <input id={id} className="field h-9 w-20" inputMode="numeric" placeholder="+10" value={delta} onChange={(e) => setDelta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (valid) adjust.mutate(amount);
              }
            }} />
          <button type="button" className="btn btn-outline h-9" disabled={!valid || adjust.isPending} onClick={() => adjust.mutate(amount)}>Apply</button>
        </div>
        {adjust.isError && <p role="alert" className="mt-1 text-xs text-danger">{errorText(adjust.error)}</p>}
      </td>
    </tr>
  );
}
