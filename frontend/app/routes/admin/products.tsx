import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { errorText, money, type AdminProduct, type AdminVariant } from "~/features/admin/shared";
import { api } from "~/lib/http";
import type { Department, Page } from "~/lib/types";

const PRODUCT_STATUS: Record<string, string> = { DRAFT: "Draft (hidden)", ACTIVE: "On sale", ARCHIVED: "Archived (hidden)" };

function StockCell({ variant, onDone }: { variant: AdminVariant; onDone: () => void }) {
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
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) adjust.mutate(amount);
          }}
        >
          <label htmlFor={id} className="sr-only">Add or remove stock for {variant.color} {variant.sizeCode}</label>
          <input id={id} className="field h-9 w-20" inputMode="numeric" placeholder="+5 / -2" value={delta} onChange={(e) => setDelta(e.target.value)} />
          <button type="submit" className="btn btn-outline h-9" disabled={!valid || adjust.isPending}>Apply</button>
        </form>
        {adjust.isError && <p role="alert" className="mt-1 text-xs text-danger">{errorText(adjust.error)}</p>}
      </td>
    </tr>
  );
}

/**
 * Deleting asks once more, naming the product, because it cannot be undone from the dashboard.
 * Orders that already contain the product keep it; customers can no longer see or buy it.
 */
function DeleteProduct({ id, name, onDone }: { id: number; name: string; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: () => api<void>("DELETE", `/api/v1/admin/products/${id}`),
    onSuccess: onDone,
  });
  if (!asking) {
    return (
      <button type="button" className="cursor-pointer px-2 text-sm text-danger underline" onClick={() => setAsking(true)}>
        Delete
      </button>
    );
  }
  return (
    <span role="group" aria-label={`Delete ${name}?`} className="flex flex-wrap items-center gap-2 border border-danger px-3 py-2 text-sm">
      <span>Delete “{name}” for good? Past orders keep it.</span>
      <button
        type="button"
        className="btn h-9 border-danger bg-danger text-bone"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        {remove.isPending ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" className="cursor-pointer underline" onClick={() => setAsking(false)}>
        Keep it
      </button>
      {remove.isError && <span role="alert" className="basis-full text-danger">{errorText(remove.error)}</span>}
    </span>
  );
}

const DEPARTMENT_STATE: Record<AdminDepartment["status"], string> = {
  ACTIVE: "Open",
  COMING_SOON: "Coming soon",
  HIDDEN: "Hidden from the store",
};

type AdminDepartment = Omit<Department, "status"> & { status: "ACTIVE" | "COMING_SOON" | "HIDDEN" };

/**
 * Each department is open, coming soon (name shown with a "Soon" tag, products hidden) or hidden
 * (not shown anywhere in the store: menu, home page or shop). Hidden ones stay listed here to show again.
 */
function Departments() {
  const client = useQueryClient();
  const departments = useQuery({
    queryKey: ["admin", "departments"],
    queryFn: () => api<AdminDepartment[]>("GET", "/api/v1/admin/departments"),
  });
  const setStatus = useMutation({
    mutationFn: ({ slug, status }: { slug: string; status: string }) =>
      api<void>("PATCH", `/api/v1/admin/departments/${slug}`, { status }),
    onSettled: () => client.invalidateQueries({ queryKey: ["admin", "departments"] }),
  });
  if (!departments.data) return null;
  return (
    <section className="mt-6 border border-line bg-card p-4" aria-labelledby="departments-title">
      <h2 id="departments-title" className="text-sm font-semibold">Departments</h2>
      <p className="mt-1 text-xs text-stone">
        Customers can only shop a department that is open. “Coming soon” shows its name with a “Soon” tag and hides its
        products. “Hide” removes it from the store completely: the menu, the home page and the shop.
      </p>
      {setStatus.isError && <p role="alert" className="mt-2 text-sm text-danger">{errorText(setStatus.error)}</p>}
      <ul className="mt-3 flex flex-wrap gap-3">
        {departments.data.map((d) => {
          const hidden = d.status === "HIDDEN";
          const choices = (["ACTIVE", "COMING_SOON", "HIDDEN"] as const).filter((s) => s !== d.status);
          const label = {
            ACTIVE: `Open ${d.nameEn}`,
            COMING_SOON: hidden ? `Show ${d.nameEn} as coming soon` : `Close ${d.nameEn}`,
            HIDDEN: `Hide ${d.nameEn}`,
          };
          return (
            <li
              key={d.slug}
              className={`flex flex-wrap items-center gap-3 border px-3 py-2 text-sm ${hidden ? "border-dashed border-stone/60 text-stone" : "border-line"}`}
            >
              <span className="me-auto">
                <span className="font-semibold">{d.nameEn}</span>
                <span className="block text-xs text-stone">
                  {DEPARTMENT_STATE[d.status]}
                  {d.status === "ACTIVE" && ` · ${d.productCount} on sale`}
                </span>
              </span>
              {choices.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={s === "ACTIVE" ? "btn btn-primary" : "btn btn-outline"}
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ slug: d.slug, status: s })}
                >
                  {label[s]}
                </button>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function AdminProducts() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const page = Number(params.get("page")) || 0;
  const key = ["admin", "products", q, page];

  const products = useQuery({
    queryKey: key,
    queryFn: () => api<Page<AdminProduct>>("GET", `/api/v1/admin/products?page=${page}&q=${encodeURIComponent(q)}`),
    placeholderData: keepPreviousData,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["admin"] });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api<void>("PATCH", `/api/v1/admin/products/${id}/status`, { status }),
    onSettled: refresh,
  });

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="display text-2xl">Products &amp; stock</h1>
        <Link to="/admin/products/new" className="btn btn-primary">New product</Link>
      </div>
      <p className="mt-2 text-sm text-stone">
        “Reserved” is stock held for orders that have not shipped yet. “Can sell” is what customers can still buy.
      </p>

      <Departments />

      <form
        className="mt-5 flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const value = String(new FormData(e.currentTarget).get("q") ?? "").trim();
          setParams(value ? { q: value } : {});
        }}
      >
        <div>
          <label htmlFor="q" className="mb-1.5 block text-sm font-medium">Product name</label>
          <input id="q" name="q" defaultValue={q} key={q} className="field w-64" />
        </div>
        <button type="submit" className="btn btn-primary">Search</button>
      </form>
      {setStatus.isError && <p role="alert" className="mt-4 text-sm text-danger">{errorText(setStatus.error)}</p>}

      <ul className="mt-6 space-y-4" aria-busy={products.isFetching}>
        {products.data?.items.map((p) => (
          <li key={p.id} className="border border-line bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  <Link to={`/admin/products/${p.id}`} className="underline">{p.nameEn}</Link>
                </h2>
                <p className="text-sm text-stone">
                  {p.salePrice ? `${money(p.salePrice)} (was ${money(p.price)})` : money(p.price)} · {PRODUCT_STATUS[p.status]}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: p.id, status: p.status === "ACTIVE" ? "DRAFT" : "ACTIVE" })}
                >
                  {p.status === "ACTIVE" ? "Take off sale" : "Put on sale"}
                </button>
                <DeleteProduct id={p.id} name={p.nameEn} onDone={refresh} />
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="text-xs text-stone">
                  <tr>
                    <th scope="col" className="py-1 pe-3 text-start font-medium">Colour · size</th>
                    <th scope="col" className="px-3 py-1 text-start font-medium">In warehouse</th>
                    <th scope="col" className="px-3 py-1 text-start font-medium">Reserved</th>
                    <th scope="col" className="px-3 py-1 text-start font-medium">Can sell</th>
                    <th scope="col" className="py-1 ps-3 text-start font-medium">Add / remove</th>
                  </tr>
                </thead>
                <tbody>
                  {p.variants.map((v) => <StockCell key={v.variantId} variant={v} onDone={refresh} />)}
                </tbody>
              </table>
            </div>
          </li>
        ))}
      </ul>
      {products.isPending && <p className="mt-6 text-sm text-stone">Loading…</p>}
      {products.isError && <p className="mt-6 text-sm text-danger" role="alert">Could not load products.</p>}
      {products.data?.items.length === 0 && <p className="mt-6 text-sm text-stone">No products match.</p>}

      {products.data && products.data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button type="button" className="btn btn-outline" disabled={page === 0} onClick={() => setParams({ ...(q && { q }), page: String(page - 1) })}>Previous</button>
          <span>Page {page + 1} of {products.data.totalPages}</span>
          <button type="button" className="btn btn-outline" disabled={page + 1 >= products.data.totalPages} onClick={() => setParams({ ...(q && { q }), page: String(page + 1) })}>Next</button>
        </div>
      )}
    </div>
  );
}
