import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorText, money, when } from "~/features/admin/shared";
import { api } from "~/lib/http";

interface Promotion {
  id: number;
  nameEn: string;
  nameAr: string;
  automatic: boolean;
  type: "PERCENT" | "FIXED" | "FREE_DELIVERY";
  value: number;
  scope: "ALL" | "DEPARTMENT" | "CATEGORY" | "PRODUCT";
  targetIds: number[];
  minOrderValue: number;
  startsAt?: string;
  endsAt?: string;
  active: boolean;
  code?: string;
  maxRedemptions?: number;
  perCustomerLimit?: number;
  redeemedCount?: number;
}

interface Targets {
  departments: { id: number; name: string }[];
  categories: { id: number; name: string }[];
  products: { id: number; name: string }[];
}

const SCOPE_LABEL = { ALL: "Everything", DEPARTMENT: "Departments", CATEGORY: "Categories", PRODUCT: "Products" };

function describe(p: Promotion): string {
  const what = p.type === "PERCENT" ? `${p.value}% off` : p.type === "FIXED" ? `${money(p.value)} off` : "Free delivery";
  const where = p.scope === "ALL" ? "everything" : `${p.targetIds.length} ${SCOPE_LABEL[p.scope].toLowerCase()}`;
  const min = p.minOrderValue > 0 ? `, orders from ${money(p.minOrderValue)}` : "";
  return `${what} on ${where}${min}`;
}

/** The API takes the whole offer on every save, so switching one on or off resends what it already has. */
function body(p: Promotion, active: boolean) {
  return {
    nameEn: p.nameEn, nameAr: p.nameAr, automatic: p.automatic, type: p.type, value: p.value, scope: p.scope,
    targetIds: p.targetIds, minOrderValue: p.minOrderValue, startsAt: p.startsAt ?? null, endsAt: p.endsAt ?? null,
    active, code: p.code ?? null, maxRedemptions: p.maxRedemptions ?? null, perCustomerLimit: p.perCustomerLimit ?? 1,
  };
}

export default function AdminPromotions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ["admin", "promotions"] });
  const promotions = useQuery({ queryKey: ["admin", "promotions"], queryFn: () => api<Promotion[]>("GET", "/api/v1/admin/promotions") });
  const targets = useQuery({ queryKey: ["admin", "promotions", "targets"], queryFn: () => api<Targets>("GET", "/api/v1/admin/promotions/targets") });
  const toggle = useMutation({
    mutationFn: (p: Promotion) => api("PUT", `/api/v1/admin/promotions/${p.id}`, body(p, !p.active)),
    onSettled: refresh,
  });

  const [kind, setKind] = useState<"code" | "automatic">("code");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [type, setType] = useState<Promotion["type"]>("PERCENT");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<Promotion["scope"]>("ALL");
  const [targetIds, setTargetIds] = useState<number[]>([]);
  const [minOrder, setMinOrder] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [code, setCode] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [perCustomer, setPerCustomer] = useState("1");

  const create = useMutation({
    mutationFn: () =>
      api("POST", "/api/v1/admin/promotions", {
        nameEn, nameAr, automatic: kind === "automatic", type,
        value: type === "FREE_DELIVERY" ? 0 : Number(value),
        scope, targetIds: scope === "ALL" ? [] : targetIds,
        minOrderValue: minOrder.trim() === "" ? 0 : Number(minOrder),
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        active: true,
        code: kind === "code" ? code.trim() : null,
        maxRedemptions: maxUses.trim() === "" ? null : Number(maxUses),
        perCustomerLimit: Number(perCustomer) || 1,
      }),
    onSuccess: () => {
      refresh();
      setNameEn(""); setNameAr(""); setValue(""); setCode(""); setTargetIds([]); setMinOrder(""); setMaxUses("");
    },
  });

  const options = scope === "DEPARTMENT" ? targets.data?.departments : scope === "CATEGORY" ? targets.data?.categories : targets.data?.products;
  const ready = nameEn.trim() && nameAr.trim() && (type === "FREE_DELIVERY" || Number(value) > 0)
    && (kind === "automatic" || code.trim().length >= 3) && (scope === "ALL" || targetIds.length > 0);
  const label = "mb-1 block text-xs font-medium";

  return (
    <div className="max-w-4xl">
      <h1 className="display text-2xl">Offers &amp; promo codes</h1>
      <p className="mt-2 text-sm text-stone">
        A customer gets one discount per order: the larger of the best automatic offer and their promo code.
        Free delivery can come on top of either.
      </p>
      {toggle.isError && <p role="alert" className="mt-3 text-sm text-danger">{errorText(toggle.error)}</p>}

      <ul className="mt-6 space-y-3" aria-busy={promotions.isFetching}>
        {promotions.data?.map((p) => (
          <li key={p.id} className={`flex flex-wrap items-start justify-between gap-3 border bg-card p-4 text-sm ${p.active ? "border-ink" : "border-line"}`}>
            <div>
              <p className="font-semibold">
                {p.nameEn} {p.code && <span className="ms-1 border border-ink px-1.5 py-0.5 text-xs">{p.code}</span>}
              </p>
              <p className="text-stone">{p.automatic ? "Automatic" : "Promo code"} · {describe(p)}</p>
              <p className="text-xs text-stone">
                {p.startsAt ? `From ${when(p.startsAt)}` : "No start date"} · {p.endsAt ? `until ${when(p.endsAt)}` : "no end date"}
                {p.code && ` · used ${p.redeemedCount ?? 0}${p.maxRedemptions ? ` of ${p.maxRedemptions}` : ""} times · ${p.perCustomerLimit} per customer`}
              </p>
            </div>
            <button type="button" className="btn btn-outline" disabled={toggle.isPending} onClick={() => toggle.mutate(p)}>
              {p.active ? "Switch off" : "Switch on"}
            </button>
          </li>
        ))}
      </ul>
      {promotions.isPending && <p className="mt-6 text-sm text-stone">Loading…</p>}
      {promotions.isError && <p className="mt-6 text-sm text-danger" role="alert">Could not load offers.</p>}
      {promotions.data?.length === 0 && <p className="mt-6 text-sm text-stone">No offers yet.</p>}

      <form
        className="mt-8 border border-line bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h2 className="font-semibold">New offer</h2>
        <div className="mt-3 flex gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" className="accent-ink" checked={kind === "code"} onChange={() => setKind("code")} />
            Promo code the customer types
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" className="accent-ink" checked={kind === "automatic"} onChange={() => setKind("automatic")} />
            Automatic, for everyone
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="p-en" className={label}>Name customers see (English)</label>
            <input id="p-en" className="field" maxLength={120} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p-ar" className={label}>Name customers see (Arabic)</label>
            <input id="p-ar" className="field" dir="rtl" maxLength={120} value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p-type" className={label}>Discount</label>
            <select id="p-type" className="field" value={type} onChange={(e) => setType(e.target.value as Promotion["type"])}>
              <option value="PERCENT">Percentage off</option>
              <option value="FIXED">Amount off (EGP)</option>
              <option value="FREE_DELIVERY">Free delivery</option>
            </select>
          </div>
          {type !== "FREE_DELIVERY" && (
            <div>
              <label htmlFor="p-value" className={label}>{type === "PERCENT" ? "Percent (1–90)" : "Amount (EGP)"}</label>
              <input id="p-value" className="field" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          )}
          {kind === "code" && (
            <>
              <div>
                <label htmlFor="p-code" className={label}>Code (letters, numbers, dashes)</label>
                <input id="p-code" className="field uppercase" maxLength={30} value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div>
                <label htmlFor="p-max" className={label}>Total uses allowed (empty = no limit)</label>
                <input id="p-max" className="field" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
              </div>
              <div>
                <label htmlFor="p-per" className={label}>Uses per customer</label>
                <input id="p-per" className="field" inputMode="numeric" value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <label htmlFor="p-min" className={label}>Minimum order (EGP, empty = none)</label>
            <input id="p-min" className="field" inputMode="decimal" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p-start" className={label}>Starts (empty = now)</label>
            <input id="p-start" type="datetime-local" className="field" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p-end" className={label}>Ends (empty = never)</label>
            <input id="p-end" type="datetime-local" className="field" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p-scope" className={label}>Applies to</label>
            <select id="p-scope" className="field" value={scope} onChange={(e) => { setScope(e.target.value as Promotion["scope"]); setTargetIds([]); }}>
              {Object.entries(SCOPE_LABEL).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </div>
        </div>

        {scope !== "ALL" && (
          <fieldset className="mt-4">
            <legend className={label}>Choose {SCOPE_LABEL[scope].toLowerCase()}</legend>
            <div className="max-h-48 overflow-y-auto border border-line p-3 text-sm">
              {(options ?? []).map((o) => (
                <label key={o.id} className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    className="accent-ink"
                    checked={targetIds.includes(o.id)}
                    onChange={() => setTargetIds((list) => (list.includes(o.id) ? list.filter((x) => x !== o.id) : [...list, o.id]))}
                  />
                  {o.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={!ready || create.isPending}>
            {create.isPending ? "Saving…" : "Create and switch on"}
          </button>
          {create.isSuccess && <span role="status" className="text-sm">Created.</span>}
          {create.isError && <span role="alert" className="text-sm text-danger">{errorText(create.error)}</span>}
        </div>
      </form>
    </div>
  );
}
