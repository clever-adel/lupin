import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { money, when, whatsAppLink } from "~/features/admin/shared";
import { api } from "~/lib/http";
import type { Page } from "~/lib/types";

export interface AdminCustomerRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  signUp: "GOOGLE" | "EMAIL" | "GUEST";
  status: "ACTIVE" | "DISABLED";
  joinedAt: string;
  lastLoginAt: string | null;
  orders: number;
  spent: number;
  lastOrderAt: string | null;
  governorate: string | null;
  marketingOptIn: boolean;
}

interface CustomerSummary {
  customers: number;
  newThisWeek: number;
  withOrders: number;
  marketingOptIn: number;
}

const SORTS: Record<string, string> = {
  newest: "Newest first",
  spent: "Spent the most",
  orders: "Most orders",
  active: "Signed in lately",
};

/** Everyone with an account on the store. Search and sort live in the address bar, like Orders. */
export default function AdminCustomers() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? "newest";
  const page = Number(params.get("page")) || 0;

  const summary = useQuery({
    queryKey: ["admin", "customers", "summary"],
    queryFn: () => api<CustomerSummary>("GET", "/api/v1/admin/customers/summary"),
  });
  const customers = useQuery({
    queryKey: ["admin", "customers", q, sort, page],
    queryFn: () =>
      api<Page<AdminCustomerRow>>(
        "GET",
        `/api/v1/admin/customers?page=${page}&sort=${encodeURIComponent(sort)}&q=${encodeURIComponent(q)}`,
      ),
    placeholderData: keepPreviousData,
  });

  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };

  const tiles: [string, number | undefined][] = [
    ["Customers", summary.data?.customers],
    ["Joined this week", summary.data?.newThisWeek],
    ["Have ordered", summary.data?.withOrders],
    ["Accept offers", summary.data?.marketingOptIn],
  ];

  return (
    <div>
      <h1 className="display text-2xl">Customers</h1>

      <ul className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value]) => (
          <li key={label} className="border border-line bg-card p-3">
            <span className="block text-2xl font-bold">{value ?? "–"}</span>
            <span className="block text-xs text-stone">{label}</span>
          </li>
        ))}
      </ul>

      <form
        className="mt-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() });
        }}
      >
        <div>
          <label htmlFor="q" className="mb-1.5 block text-sm font-medium">Name, email or phone</label>
          <input id="q" name="q" defaultValue={q} key={q} className="field w-64" />
        </div>
        <div>
          <label htmlFor="sort" className="mb-1.5 block text-sm font-medium">Sort</label>
          <select id="sort" className="field" value={sort} onChange={(e) => set({ sort: e.target.value })}>
            {Object.entries(SORTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">Search</button>
        {(q || sort !== "newest") && (
          <button type="button" className="btn btn-outline" onClick={() => setParams({})}>Clear</button>
        )}
      </form>

      <div className="mt-5 overflow-x-auto border border-line bg-card" aria-busy={customers.isFetching}>
        <table className="w-full min-w-[52rem] text-start text-sm">
          <thead className="border-b border-line text-xs text-stone">
            <tr>
              {["Customer", "Contact", "Joined", "Orders", "Spent", "Last order", "Last sign-in"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 text-start font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {customers.data?.items.map((c) => {
              const wa = whatsAppLink(c.phone);
              return (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <th scope="row" className="px-3 py-3 text-start font-semibold">
                    {c.fullName}
                    <span className="block text-xs font-normal text-stone">
                      {c.signUp === "GOOGLE" ? "Google" : c.signUp === "GUEST" ? "Guest (no account)" : "Email"}
                      {c.governorate ? ` · ${c.governorate}` : ""}
                      {c.status === "DISABLED" ? " · Disabled" : ""}
                    </span>
                  </th>
                  <td className="px-3 py-3">
                    {c.email && <a href={`mailto:${c.email}`} className="block underline">{c.email}</a>}
                    {c.phone && (
                      <span className="block text-xs text-stone">
                        {c.phone}
                        {wa && (
                          <>
                            {" · "}
                            <a href={wa} target="_blank" rel="noreferrer" className="underline">WhatsApp</a>
                          </>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-stone">{when(c.joinedAt)}</td>
                  <td className="px-3 py-3">
                    {c.orders > 0 ? (
                      <Link to={`/admin?q=${encodeURIComponent(c.phone ?? c.fullName)}`} className="underline">{c.orders}</Link>
                    ) : (
                      c.orders
                    )}
                  </td>
                  <td className="px-3 py-3 font-semibold">{c.spent > 0 ? money(c.spent) : "—"}</td>
                  <td className="px-3 py-3 text-stone">{c.lastOrderAt ? when(c.lastOrderAt) : "—"}</td>
                  <td className="px-3 py-3 text-stone">{c.lastLoginAt ? when(c.lastLoginAt) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {customers.isPending && <p className="p-4 text-sm text-stone">Loading…</p>}
        {customers.isError && <p className="p-4 text-sm text-danger" role="alert">Could not load customers.</p>}
        {customers.data?.items.length === 0 && <p className="p-4 text-sm text-stone">No customers match.</p>}
      </div>
      <p className="mt-2 text-xs text-stone">Spent counts paid, confirmed, shipped and delivered orders only.</p>

      {customers.data && customers.data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button type="button" className="btn btn-outline" disabled={page === 0} onClick={() => set({ page: String(page - 1) })}>Previous</button>
          <span>Page {page + 1} of {customers.data.totalPages}</span>
          <button type="button" className="btn btn-outline" disabled={page + 1 >= customers.data.totalPages} onClick={() => set({ page: String(page + 1) })}>Next</button>
        </div>
      )}
    </div>
  );
}
