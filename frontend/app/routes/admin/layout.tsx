import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet } from "react-router";
import { useRequireSignIn, useSignOut } from "~/features/auth/session";
import type { Summary } from "~/features/admin/shared";
import { api } from "~/lib/http";

export function meta() {
  return [{ title: "LUPIN. — Staff" }, { name: "robots", content: "noindex, nofollow" }];
}

/**
 * Staff dashboard shell. Nothing here is server-rendered with data, and hiding the page is only a
 * convenience: every /api/v1/admin call is checked on the server against the signed-in user's role.
 */
export default function AdminLayout() {
  const me = useRequireSignIn("/sign-in");
  const signOut = useSignOut();
  const isStaff = Boolean(me.data?.roles.some((r) => r === "ADMIN" || r === "OWNER"));

  const summary = useQuery({
    queryKey: ["admin", "summary"],
    queryFn: () => api<Summary>("GET", "/api/v1/admin/summary"),
    enabled: isStaff,
    refetchInterval: 60_000,
  });

  if (me.isError) {
    return <p className="p-10 text-danger" role="alert">Something went wrong. Reload the page.</p>;
  }
  if (!me.data) {
    return <p className="p-10 text-stone" aria-busy="true">One moment…</p>;
  }
  if (!isStaff) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <h1 className="display text-2xl">Staff only.</h1>
          <p className="mt-3 text-sm text-stone">This account does not have access to the dashboard.</p>
          <Link to="/" className="btn btn-primary mt-6">Back to the store</Link>
        </div>
      </main>
    );
  }

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-semibold ${isActive ? "border-bone text-bone" : "border-transparent text-bone/60 hover:text-bone"}`;
  const badge = (value: number | undefined) =>
    value ? <span className="rounded-full bg-bone px-1.5 text-xs font-bold text-ink">{value}</span> : null;

  return (
    <div className="min-h-dvh bg-paper">
      <header className="bg-ink text-bone">
        <div className="shell flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3">
          <Link to="/admin" className="flex items-center gap-3">
            <img src="/brand/lupin-mark.png" alt="LUPIN." width={396} height={251} className="h-6 w-auto" />
            <span className="label text-bone/70">Staff</span>
          </Link>
          <div className="flex items-center gap-4 text-xs text-bone/70">
            <span>{me.data.fullName} · {me.data.roles.includes("OWNER") ? "Owner" : "Admin"}</span>
            <Link to="/" className="underline">Store</Link>
            <button type="button" className="cursor-pointer underline" onClick={() => signOut.mutate()}>Sign out</button>
          </div>
        </div>
        <nav aria-label="Dashboard" className="shell flex gap-6 overflow-x-auto">
          <NavLink to="/admin" end className={link}>Orders</NavLink>
          <NavLink to="/admin/transfers" className={link}>Transfers to check {badge(summary.data?.transfersToCheck)}</NavLink>
          <NavLink to="/admin/products" className={link}>Products &amp; stock {badge(summary.data?.lowStockVariants)}</NavLink>
          <NavLink to="/admin/promotions" className={link}>Offers</NavLink>
          <NavLink to="/admin/content" className={link}>Content</NavLink>
          <NavLink to="/admin/settings" className={link}>Settings</NavLink>
        </nav>
      </header>
      <main className="shell py-8">
        <Outlet context={{ summary: summary.data, isOwner: me.data.roles.includes("OWNER") }} />
      </main>
    </div>
  );
}

export interface AdminContext {
  summary?: Summary;
  isOwner: boolean;
}
