import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { errorText, when } from "~/features/admin/shared";
import { api } from "~/lib/http";

type Status = "PENDING" | "APPROVED" | "REJECTED";

interface AdminReview {
  id: number;
  productSlug: string;
  productName: string;
  customerName: string;
  customerEmail?: string;
  orderReference: string;
  rating: number;
  body: string;
  status: Status;
  createdAt: string;
}

const TABS: { status: Status; label: string }[] = [
  { status: "PENDING", label: "Waiting" },
  { status: "APPROVED", label: "Published" },
  { status: "REJECTED", label: "Hidden" },
];

function Row({ review, onDone }: { review: AdminReview; onDone: () => void }) {
  const moderate = useMutation({
    mutationFn: (status: Status) => api("POST", `/api/v1/admin/reviews/${review.id}/status`, { status }),
    onSuccess: onDone,
  });
  return (
    <li className="border border-line bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-gold" aria-label={`${review.rating} out of 5`}>{"★".repeat(review.rating)}<span className="text-line">{"★".repeat(5 - review.rating)}</span></p>
          <p className="mt-1 font-semibold">
            <a href={`/product/${review.productSlug}`} target="_blank" rel="noopener noreferrer" className="underline">{review.productName}</a>
          </p>
          <p className="text-xs text-stone">
            {review.customerName}{review.customerEmail && ` · ${review.customerEmail}`} ·{" "}
            <Link to={`/admin/orders/${review.orderReference}`} className="underline">{review.orderReference}</Link> · {when(review.createdAt)}
          </p>
          {review.body ? <p className="mt-2 whitespace-pre-line">{review.body}</p> : <p className="mt-2 text-stone">(stars only, no text)</p>}
        </div>
        <div className="flex gap-2">
          {review.status !== "APPROVED" && (
            <button type="button" className="btn btn-primary" disabled={moderate.isPending} onClick={() => moderate.mutate("APPROVED")}>Publish</button>
          )}
          {review.status !== "REJECTED" && (
            <button type="button" className="btn btn-outline" disabled={moderate.isPending} onClick={() => moderate.mutate("REJECTED")}>Hide</button>
          )}
        </div>
      </div>
      {moderate.isError && <p role="alert" className="mt-2 text-danger">{errorText(moderate.error)}</p>}
    </li>
  );
}

/** Customer reviews of delivered pieces: publish them on the product page or keep them hidden. */
export default function AdminReviews() {
  const client = useQueryClient();
  const [status, setStatus] = useState<Status>("PENDING");
  const query = useQuery({
    queryKey: ["admin", "reviews", status],
    queryFn: () => api<AdminReview[]>("GET", `/api/v1/admin/reviews?status=${status}`),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["admin", "reviews"] });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Reviews</h1>
      <p className="mt-1 text-sm text-stone">Customers can rate each piece once their order is delivered. Only published reviews show on the product page.</p>
      <div className="mt-4 flex gap-2" role="group" aria-label="Show">
        {TABS.map((tab) => (
          <button key={tab.status} type="button" aria-pressed={status === tab.status}
            className={`btn h-9 ${status === tab.status ? "btn-primary" : "btn-outline"}`} onClick={() => setStatus(tab.status)}>
            {tab.label}
          </button>
        ))}
      </div>
      {query.isError && <p role="alert" className="mt-4 text-danger">{errorText(query.error)}</p>}
      {query.data && query.data.length === 0 && <p className="mt-4 text-stone">Nothing here.</p>}
      <ul className="mt-4 space-y-3">
        {(query.data ?? []).map((r) => <Row key={r.id} review={r} onDone={refresh} />)}
      </ul>
    </div>
  );
}
