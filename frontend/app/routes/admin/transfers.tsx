import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { errorText, money, when, type Transfer } from "~/features/admin/shared";
import { api } from "~/lib/http";

/** InstaPay transfers customers say they made. An order is paid only after someone confirms it here. */
export default function AdminTransfers() {
  const client = useQueryClient();
  const [asking, setAsking] = useState<{ id: string; received: boolean } | null>(null);
  const transfers = useQuery({
    queryKey: ["admin", "transfers"],
    queryFn: () => api<Transfer[]>("GET", "/api/v1/admin/payments/transfers"),
    refetchInterval: 60_000,
  });
  const decide = useMutation({
    mutationFn: ({ id, received }: { id: string; received: boolean }) =>
      api<void>("POST", `/api/v1/admin/payments/${id}/${received ? "confirm" : "reject"}`, {}),
    onSettled: () => {
      setAsking(null);
      client.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  return (
    <div className="max-w-3xl">
      <h1 className="display text-2xl">Transfers to check</h1>
      <p className="mt-2 text-sm text-stone">
        Open the InstaPay account, find the transfer by its reference and amount, then confirm it. Confirm only
        when the money is really there: confirming marks the order as paid.
      </p>
      {decide.isError && <p role="alert" className="mt-4 text-sm text-danger">{errorText(decide.error)}</p>}

      <ul className="mt-6 space-y-3" aria-busy={transfers.isFetching}>
        {transfers.data?.map((tr) => (
          <li key={tr.paymentId} className="border border-line bg-card p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold">{money(tr.amount)}</p>
                <p>Reference: <span className="font-semibold">{tr.transferReference}</span></p>
                <p className="text-stone">
                  {tr.customerName} · {tr.customerPhone} · order{" "}
                  <Link to={`/admin/orders/${tr.orderReference}`} className="underline">{tr.orderReference}</Link>
                </p>
                <p className="text-xs text-stone">Sent to us {when(tr.submittedAt)}</p>
              </div>
              {asking?.id === tr.paymentId ? (
                <div className="text-end">
                  <p className="font-semibold">
                    {asking.received ? `Is ${money(tr.amount)} in the account?` : "Reject this transfer?"}
                  </p>
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" className="btn btn-outline" disabled={decide.isPending} onClick={() => setAsking(null)}>Back</button>
                    <button type="button" className="btn btn-primary" disabled={decide.isPending} onClick={() => decide.mutate(asking)}>
                      {asking.received ? "Yes, mark paid" : "Yes, reject"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button type="button" className="btn btn-outline" onClick={() => setAsking({ id: tr.paymentId, received: false })}>Not received</button>
                  <button type="button" className="btn btn-primary" onClick={() => setAsking({ id: tr.paymentId, received: true })}>Money received</button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {transfers.isPending && <p className="mt-6 text-sm text-stone">Loading…</p>}
      {transfers.isError && <p className="mt-6 text-sm text-danger" role="alert">Could not load transfers.</p>}
      {transfers.data?.length === 0 && <p className="mt-6 border-y border-line py-10 text-center text-sm text-stone">Nothing to check right now.</p>}
    </div>
  );
}
