import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { errorText, money, type AdminOrder, type BostaInfo } from "~/features/admin/shared";
import { api } from "~/lib/http";

/**
 * "Send with Bosta": creates the delivery at Bosta and marks the order shipped with Bosta's tracking
 * number. Shown on a PROCESSING order. Pickup itself is booked from Bosta's own dashboard.
 */
export function BostaPanel({ reference, onSent }: { reference: string; onSent: (updated: AdminOrder) => void }) {
  const client = useQueryClient();
  const key = ["admin", "order", reference, "bosta"];
  const info = useQuery({
    queryKey: key,
    queryFn: () => api<BostaInfo>("GET", `/api/v1/admin/orders/${encodeURIComponent(reference)}/bosta`),
    retry: false,
    staleTime: 60_000,
  });
  const [districtId, setDistrictId] = useState("");
  const [filter, setFilter] = useState("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (info.data?.suggestedDistrictId && !districtId) setDistrictId(info.data.suggestedDistrictId);
  }, [info.data?.suggestedDistrictId, districtId]);

  const send = useMutation({
    mutationFn: () =>
      api<AdminOrder>("POST", `/api/v1/admin/orders/${encodeURIComponent(reference)}/bosta`, {
        districtId,
        notes: notes || null,
      }),
    onSuccess: (updated) => {
      setConfirming(false);
      client.invalidateQueries({ queryKey: key });
      onSent(updated);
    },
    onError: () => setConfirming(false),
  });

  const districts = useMemo(() => {
    const all = info.data?.districts ?? [];
    const f = filter.trim().toLowerCase();
    if (!f) return all;
    return all.filter((d) => d.name.toLowerCase().includes(f) || d.nameAr.includes(filter.trim()) || d.districtId === districtId);
  }, [info.data?.districts, filter, districtId]);

  const box = "mt-4 border border-line bg-card p-4";
  if (info.isPending) return <section className={box} aria-busy="true"><p className="text-sm text-stone">Checking Bosta…</p></section>;
  if (info.isError) {
    return (
      <section className={box} aria-labelledby="bosta-title">
        <h2 id="bosta-title" className="text-sm font-semibold">Send with Bosta</h2>
        <p role="alert" className="mt-2 text-sm text-danger">{errorText(info.error)}</p>
        <button type="button" className="btn btn-outline mt-3" onClick={() => info.refetch()}>Try again</button>
      </section>
    );
  }
  const b = info.data;
  const chosen = b.districts.find((d) => d.districtId === districtId);

  return (
    <section className={box} aria-labelledby="bosta-title">
      <h2 id="bosta-title" className="text-sm font-semibold">Send with Bosta</h2>
      {!b.configured ? (
        <p className="mt-2 text-sm text-stone">
          Bosta is not set up on the server yet. The owner adds the Bosta API key on the hosting dashboard (BOSTA_API_KEY).
          Until then, ship with any courier using “Mark as shipped”.
        </p>
      ) : !b.canSend ? (
        <p className="mt-2 text-sm text-stone">{b.reason}</p>
      ) : (
        <form
          className="mt-3 space-y-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!chosen) return;
            if (!confirming) setConfirming(true);
            else send.mutate();
          }}
        >
          <p>
            Bosta city: <span className="font-semibold">{b.cityName}</span> · Customer wrote: <span className="font-semibold">{b.customerCity}</span>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="bosta-filter" className="mb-1.5 block font-medium">Find district</label>
              <input id="bosta-filter" className="field" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Type to filter" />
            </div>
            <div>
              <label htmlFor="bosta-district" className="mb-1.5 block font-medium">District (required by Bosta)</label>
              <select id="bosta-district" className="field" required value={districtId} onChange={(e) => { setDistrictId(e.target.value); setConfirming(false); }}>
                <option value="">Choose…</option>
                {districts.map((d) => (
                  <option key={d.districtId} value={d.districtId}>{d.name}{d.nameAr ? ` — ${d.nameAr}` : ""}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="bosta-notes" className="mb-1.5 block font-medium">Note for the courier (optional)</label>
            <input id="bosta-notes" className="field" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p>
            Cash to collect: <span className="font-semibold">{b.codAmount > 0 ? money(b.codAmount) : "nothing (already paid)"}</span>
          </p>
          {send.isError && <p role="alert" className="text-danger">{errorText(send.error)}</p>}
          {confirming && chosen && (
            <p className="font-semibold">
              Create a Bosta delivery to {chosen.name}, {b.cityName}{b.codAmount > 0 ? `, collecting ${money(b.codAmount)}` : ""}? The order becomes “Shipped” and the items leave the stock count.
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={!chosen || send.isPending}>
              {send.isPending ? "Sending…" : confirming ? "Yes, send with Bosta" : "Send with Bosta"}
            </button>
            {confirming && (
              <button type="button" className="btn btn-outline" disabled={send.isPending} onClick={() => setConfirming(false)}>Back</button>
            )}
          </div>
          <p className="text-xs text-stone">Book the pickup from the Bosta dashboard after sending.</p>
        </form>
      )}
    </section>
  );
}
