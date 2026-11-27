import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { useT } from "~/lib/i18n";
import { api, ApiError } from "~/lib/http";

export interface ProductReviewsData {
  count: number;
  average: number;
  reviews: { id: number; rating: number; body: string; name: string; createdAt: string }[];
}

interface Reviewable {
  orderItemId: number;
  productSlug?: string;
  nameEn: string;
  nameAr: string;
  color: string;
  size: string;
  imageUrl?: string;
  rating?: number;
  status?: "PENDING" | "APPROVED" | "REJECTED";
}

/** Five stars, filled up to the rating (rounded to the nearest half for the average). */
export function Stars({ value, label }: { value: number; label: string }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span role="img" aria-label={label} className="inline-flex text-gold" dir="ltr">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} aria-hidden="true" className={i <= rounded ? "" : i - 0.5 === rounded ? "opacity-60" : "opacity-25"}>★</span>
      ))}
    </span>
  );
}

/** Approved reviews under a product. Hidden until the first one is approved. */
export function ProductReviews({ slug }: { slug: string }) {
  const { t, dateTime } = useT();
  const query = useQuery({
    queryKey: ["reviews", slug],
    queryFn: () => api<ProductReviewsData>("GET", `/api/v1/catalog/products/${encodeURIComponent(slug)}/reviews`),
    staleTime: 60_000,
  });
  const data = query.data;
  if (!data || data.count === 0) return null;

  return (
    <section className="pt-16" aria-labelledby="reviews-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label text-stone">{t("reviews.kicker")}</p>
          <h2 id="reviews-title" className="display mt-2 text-2xl md:text-3xl">{t("reviews.title")}</h2>
        </div>
        <p className="flex items-center gap-2 text-sm">
          <Stars value={data.average} label={t("reviews.average", { rating: data.average })} />
          <span className="font-semibold" dir="ltr">{data.average.toFixed(1)}</span>
          <span className="text-stone">· {t("reviews.count", { count: data.count })}</span>
        </p>
      </div>
      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {data.reviews.map((r) => (
          <li key={r.id} className="border border-line bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <Stars value={r.rating} label={t("reviews.rating", { rating: r.rating })} />
              <time dateTime={r.createdAt} className="text-xs text-stone">{dateTime(r.createdAt)}</time>
            </div>
            {r.body && <p className="mt-2 text-sm leading-relaxed">{r.body}</p>}
            <p className="mt-2 text-xs font-semibold">{r.name}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RateItem({ item, reference }: { item: Reviewable; reference: string }) {
  const { t, pick } = useT();
  const client = useQueryClient();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const send = useMutation({
    mutationFn: () => api("POST", "/api/v1/reviews", { orderItemId: item.orderItemId, rating, body: body.trim() }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["order-reviews", reference] }),
  });
  const name = pick(item, "name");

  return (
    <li className="border-b border-line py-4 last:border-0">
      <p className="text-sm font-semibold">{name} <span className="font-normal text-stone">· {item.color} · <span dir="ltr">{item.size}</span></span></p>
      {item.rating ? (
        <p className="mt-1 flex items-center gap-2 text-sm">
          <Stars value={item.rating} label={t("reviews.rating", { rating: item.rating })} />
          <span className="text-stone">{item.status === "APPROVED" ? t("reviews.published") : item.status === "REJECTED" ? t("reviews.notPublished") : t("reviews.thanks")}</span>
        </p>
      ) : (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (rating > 0) send.mutate();
          }}
        >
          <div role="radiogroup" aria-label={t("reviews.yourRating", { name })} className="flex gap-1" dir="ltr">
            {[1, 2, 3, 4, 5].map((i) => (
              <button key={i} type="button" role="radio" aria-checked={rating === i} aria-label={t("reviews.rating", { rating: i })}
                className={`cursor-pointer text-2xl leading-none ${i <= rating ? "text-gold" : "text-line"}`} onClick={() => setRating(i)}>
                ★
              </button>
            ))}
          </div>
          <label className="block text-sm">
            <span className="sr-only">{t("reviews.comment")}</span>
            <textarea className="field min-h-20 w-full" maxLength={1000} placeholder={t("reviews.commentPlaceholder")}
              value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={rating === 0 || send.isPending}>{t("reviews.send")}</button>
          {send.isError && (
            <p role="alert" className="text-sm text-danger">
              {send.error instanceof ApiError && send.error.code === "ALREADY_REVIEWED" ? t("reviews.already") : t("reviews.failed")}
            </p>
          )}
        </form>
      )}
    </li>
  );
}

/** On a delivered order: rate each piece. Reviews show on the product page once staff approve them. */
export function RateYourPieces({ reference }: { reference: string }) {
  const { t } = useT();
  const query = useQuery({
    queryKey: ["order-reviews", reference],
    queryFn: () => api<Reviewable[]>("GET", `/api/v1/orders/${encodeURIComponent(reference)}/reviews`),
  });
  const items = query.data ?? [];
  if (items.length === 0) return null;
  return (
    <section className="mt-8 border border-line bg-card px-4" aria-labelledby="rate-title">
      <h2 id="rate-title" className="pt-4 text-sm font-semibold">{t("reviews.rateTitle")}</h2>
      <p className="text-xs text-stone">{t("reviews.rateIntro")}</p>
      <ul>{items.map((item) => <RateItem key={item.orderItemId} item={item} reference={reference} />)}</ul>
    </section>
  );
}

interface LatestReview {
  id: number;
  rating: number;
  body: string;
  name: string;
  productSlug: string;
  productNameEn: string;
  productNameAr: string;
  createdAt: string;
}

/** The newest published reviews with words, on the home page. Hidden until there is one. */
export function HomeReviews() {
  const { t, href, pick } = useT();
  const query = useQuery({
    queryKey: ["reviews", "latest"],
    queryFn: () => api<LatestReview[]>("GET", "/api/v1/catalog/reviews/latest?limit=6"),
    staleTime: 5 * 60_000,
  });
  const reviews = query.data ?? [];
  if (reviews.length === 0) return null;
  return (
    <section className="shell pt-20" aria-labelledby="home-reviews-title">
      <p className="label text-stone">{t("home.reviewsKicker")}</p>
      <h2 id="home-reviews-title" className="display mt-2 text-2xl md:text-3xl">{t("home.reviewsTitle")}</h2>
      <ul className="mt-8 grid gap-4 md:grid-cols-3">
        {reviews.map((r) => (
          <li key={r.id} className="flex flex-col border border-line bg-card p-5">
            <Stars value={r.rating} label={t("reviews.rating", { rating: r.rating })} />
            <p className="mt-3 flex-1 text-sm leading-relaxed">“{r.body}”</p>
            <p className="mt-4 text-xs">
              <span className="font-semibold">{r.name}</span>
              {" · "}
              <Link to={href(`/product/${r.productSlug}`)} className="text-stone underline hover:text-ink">{pick(r, "productName")}</Link>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
