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
const label = "mb-1 block text-xs font-medium";

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

/** `datetime-local` wants local time without a zone; the API speaks UTC instants. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One form for a new offer and for changing an existing one. Kind and code text are fixed once created. */
function OfferForm({ existing, targets, onDone }: { existing: Promotion | null; targets: Targets | undefined; onDone: () => void }) {
  const uid = existing?.id ?? "new";
  const [kind, setKind] = useState<"code" | "automatic">(existing ? (existing.automatic ? "automatic" : "code") : "code");
  const [nameEn, setNameEn] = useState(existing?.nameEn ?? "");
  const [nameAr, setNameAr] = useState(existing?.nameAr ?? "");
  const [type, setType] = useState<Promotion["type"]>(existing?.type ?? "PERCENT");
  const [value, setValue] = useState(existing && existing.type !== "FREE_DELIVERY" ? String(existing.value) : "");
  const [scope, setScope] = useState<Promotion["scope"]>(existing?.scope ?? "ALL");
  const [targetIds, setTargetIds] = useState<number[]>(existing?.targetIds ?? []);
  const [minOrder, setMinOrder] = useState(existing && existing.minOrderValue > 0 ? String(existing.minOrderValue) : "");
  const [startsAt, setStartsAt] = useState(toLocalInput(existing?.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(existing?.endsAt));
  const [code, setCode] = useState(existing?.code ?? "");
  const [maxUses, setMaxUses] = useState(existing?.maxRedemptions ? String(existing.maxRedemptions) : "");
  const [perCustomer, setPerCustomer] = useState(String(existing?.perCustomerLimit ?? 1));

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        nameEn, nameAr, automatic: kind === "automatic", type,
        value: type === "FREE_DELIVERY" ? 0 : Number(value),
        scope, targetIds: scope === "ALL" ? [] : targetIds,
        minOrderValue: minOrder.trim() === "" ? 0 : Number(minOrder),
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        active: existing ? existing.active : true,
        code: kind === "code" ? code.trim() : null,
        maxRedemptions: maxUses.trim() === "" ? null : Number(maxUses),
        perCustomerLimit: Number(perCustomer) || 1,
      };
      return existing
        ? api("PUT", `/api/v1/admin/promotions/${existing.id}`, payload)
        : api("POST", "/api/v1/admin/promotions", payload);
    },
    onSuccess: () => {
      onDone();
      if (!existing) {
        setNameEn(""); setNameAr(""); setValue(""); setCode(""); setTargetIds([]); setMinOrder(""); setMaxUses("");
      }
    },
  });

  const options = scope === "DEPARTMENT" ? targets?.departments : scope === "CATEGORY" ? targets?.categories : targets?.products;
  const ready = nameEn.trim() && nameAr.trim() && (type === "FREE_DELIVERY" || Number(value) > 0)
    && (kind === "automatic" || code.trim().length >= 3) && (scope === "ALL" || targetIds.length > 0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) save.mutate();
      }}
    >
      {!existing && (
        <div className="mb-4 flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" className="accent-ink" checked={kind === "code"} onChange={() => setKind("code")} />
            Promo code the customer types
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" className="accent-ink" checked={kind === "automatic"} onChange={() => setKind("automatic")} />
            Automatic, for everyone
          </label>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor={`p-en-${uid}`} className={label}>Name customers see (English)</label>
          <input id={`p-en-${uid}`} className="field" maxLength={120} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`p-ar-${uid}`} className={label}>Name customers see (Arabic)</label>
          <input id={`p-ar-${uid}`} className="field" dir="rtl" maxLength={120} value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`p-type-${uid}`} className={label}>Discount</label>
          <select id={`p-type-${uid}`} className="field" value={type} onChange={(e) => setType(e.target.value as Promotion["type"])}>
            <option value="PERCENT">Percentage off</option>
            <option value="FIXED">Amount off (EGP)</option>
            <option value="FREE_DELIVERY">Free delivery</option>
          </select>
        </div>
        {type !== "FREE_DELIVERY" && (
          <div>
            <label htmlFor={`p-value-${uid}`} className={label}>{type === "PERCENT" ? "Percent (1–90)" : "Amount (EGP)"}</label>
            <input id={`p-value-${uid}`} className="field" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        )}
        {kind === "code" && (
          <>
            <div>
              <label htmlFor={`p-code-${uid}`} className={label}>{existing ? "Code (cannot be changed)" : "Code (letters, numbers, dashes)"}</label>
              <input id={`p-code-${uid}`} className="field uppercase" maxLength={30} readOnly={Boolean(existing)} value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div>
              <label htmlFor={`p-max-${uid}`} className={label}>Total uses allowed (empty = no limit)</label>
              <input id={`p-max-${uid}`} className="field" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
            </div>
            <div>
              <label htmlFor={`p-per-${uid}`} className={label}>Uses per customer</label>
              <input id={`p-per-${uid}`} className="field" inputMode="numeric" value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)} />
            </div>
          </>
        )}
        <div>
          <label htmlFor={`p-min-${uid}`} className={label}>Minimum order (EGP, empty = none)</label>
          <input id={`p-min-${uid}`} className="field" inputMode="decimal" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`p-start-${uid}`} className={label}>Starts (empty = now)</label>
          <input id={`p-start-${uid}`} type="datetime-local" className="field" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`p-end-${uid}`} className={label}>Ends (empty = never)</label>
          <input id={`p-end-${uid}`} type="datetime-local" className="field" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`p-scope-${uid}`} className={label}>Applies to</label>
          <select id={`p-scope-${uid}`} className="field" value={scope} onChange={(e) => { setScope(e.target.value as Promotion["scope"]); setTargetIds([]); }}>
            {Object.entries(SCOPE_LABEL).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
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
        <button type="submit" className="btn btn-primary" disabled={!ready || save.isPending}>
          {save.isPending ? "Saving…" : existing ? "Save changes" : "Create and switch on"}
        </button>
        {save.isSuccess && <span role="status" className="text-sm">{existing ? "Saved." : "Created."}</span>}
        {save.isError && <span role="alert" className="text-sm text-danger">{errorText(save.error)}</span>}
      </div>
    </form>
  );
}

export default function AdminPromotions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ["admin", "promotions"] });
  const promotions = useQuery({ queryKey: ["admin", "promotions"], queryFn: () => api<Promotion[]>("GET", "/api/v1/admin/promotions") });
  const targets = useQuery({ queryKey: ["admin", "promotions", "targets"], queryFn: () => api<Targets>("GET", "/api/v1/admin/promotions/targets") });
  const [editing, setEditing] = useState<number | null>(null);
  const toggle = useMutation({
    mutationFn: (p: Promotion) => api("PUT", `/api/v1/admin/promotions/${p.id}`, body(p, !p.active)),
    onSettled: refresh,
  });

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
          <li key={p.id} className={`border bg-card p-4 text-sm ${p.active ? "border-ink" : "border-line"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {p.nameEn} {p.code && <span className="ms-1 border border-ink px-1.5 py-0.5 text-xs">{p.code}</span>}
                </p>
                <p className="text-stone">{p.automatic ? "Automatic" : "Promo code"} · {describe(p)} · {p.active ? "On" : "Off"}</p>
                <p className="text-xs text-stone">
                  {p.startsAt ? `From ${when(p.startsAt)}` : "No start date"} · {p.endsAt ? `until ${when(p.endsAt)}` : "no end date"}
                  {p.code && ` · used ${p.redeemedCount ?? 0}${p.maxRedemptions ? ` of ${p.maxRedemptions}` : ""} times · ${p.perCustomerLimit} per customer`}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-outline" aria-expanded={editing === p.id} onClick={() => setEditing(editing === p.id ? null : p.id)}>
                  {editing === p.id ? "Close" : "Edit"}
                </button>
                <button type="button" className="btn btn-outline" disabled={toggle.isPending} onClick={() => toggle.mutate(p)}>
                  {p.active ? "Switch off" : "Switch on"}
                </button>
              </div>
            </div>
            {editing === p.id && (
              <div className="mt-4 border-t border-line pt-4">
                <OfferForm key={JSON.stringify(p)} existing={p} targets={targets.data} onDone={refresh} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {promotions.isPending && <p className="mt-6 text-sm text-stone">Loading…</p>}
      {promotions.isError && <p className="mt-6 text-sm text-danger" role="alert">Could not load offers.</p>}
      {promotions.data?.length === 0 && <p className="mt-6 text-sm text-stone">No offers yet.</p>}

      <section className="mt-8 border border-line bg-card p-5" aria-labelledby="new-offer">
        <h2 id="new-offer" className="mb-3 font-semibold">New offer</h2>
        <OfferForm existing={null} targets={targets.data} onDone={refresh} />
      </section>
    </div>
  );
}
