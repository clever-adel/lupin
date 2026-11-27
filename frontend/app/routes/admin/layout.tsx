import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useRequireSignIn, useSignOut } from "~/features/auth/session";
import { NewOrderBanner, OrderAlertToggle, useNewOrderAlerts } from "~/features/admin/order-alerts";
import type { Summary } from "~/features/admin/shared";
import { TwoFactorSetup } from "~/features/admin/two-factor";
import { api, ApiError } from "~/lib/http";

export function meta() {
  return [
    { title: "LUPIN. — Staff" },
    { name: "robots", content: "noindex, nofollow" },
    // "Add to Home Screen" makes the dashboard an app; on iPhone that is what allows notifications.
    { name: "apple-mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-title", content: "LUPIN Staff" },
    { name: "theme-color", content: "#0b0b0c" },
  ];
}

export function links() {
  return [
    { rel: "manifest", href: "/staff.webmanifest" },
    { rel: "apple-touch-icon", href: "/brand/apple-touch-icon.png" },
  ];
}

/**
 * Staff dashboard shell. Nothing here is server-rendered with data, and hiding the page is only a
 * convenience: every /api/v1/admin call is checked on the server against the signed-in user's role.
 */
export default function AdminLayout() {
  const me = useRequireSignIn("/sign-in");
  const signOut = useSignOut();
  const isStaff = Boolean(me.data?.roles.some((r) => r === "ADMIN" || r === "OWNER"));
  // Staff pages need two-step sign-in; the server refuses them (MFA_REQUIRED) until it is done.
  const twoStepDone = isStaff && me.data?.twoFactor === "ON";
  const navigate = useNavigate();

  const summary = useQuery({
    queryKey: ["admin", "summary"],
    queryFn: () => api<Summary>("GET", "/api/v1/admin/summary"),
    enabled: twoStepDone,
    // Often enough that a new order rings within half a minute, also in a background tab.
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    retry: false,
  });
  const alerts = useNewOrderAlerts(summary.data);

  // The server ended this session (password reset, switched off, signed out elsewhere): the failed
  // refresh has already cleared the cookies, so asking "who am I" again sends the visitor to sign in.
  const client = useQueryClient();
  // Same when the server says this sign-in has not passed the app code (for example, it was reset).
  const ended = summary.error instanceof ApiError
    && (summary.error.status === 401 || summary.error.code === "MFA_REQUIRED");
  useEffect(() => {
    if (ended) client.invalidateQueries({ queryKey: ["me"] });
  }, [ended, client]);

  // This sign-in no longer counts for the dashboard (its sessions were ended, for example by a password
  // reset, or it predates two-step sign-in): sign out and go to the sign-in page, as when a session ends.
  const signInAgain = isStaff && me.data?.twoFactor === "SIGN_IN_AGAIN";
  const { pathname } = useLocation();
  useEffect(() => {
    if (!signInAgain) return;
    signOut.mutate(undefined, {
      onSettled: () => navigate(`/sign-in?next=${encodeURIComponent(pathname)}`, { replace: true }),
    });
  }, [signInAgain]); // once, when it is noticed

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

  if (me.data.twoFactor !== "ON") {
    const again = me.data.twoFactor === "SIGN_IN_AGAIN";
    return (
      <div className="min-h-dvh bg-paper">
        <header className="bg-ink text-bone">
          <div className="shell flex items-center justify-between gap-6 py-3">
            <img src="/brand/lupin-mark.png" alt="LUPIN." width={396} height={251} className="h-6 w-auto" />
            <button type="button" className="cursor-pointer text-xs text-bone/70 underline" onClick={() => signOut.mutate()}>Sign out</button>
          </div>
        </header>
        <main className="shell py-8">
          {again ? (
            <p className="text-sm text-stone" aria-busy="true">Your session has ended. Taking you to sign in…</p>
          ) : (
            <TwoFactorSetup />
          )}
        </main>
      </div>
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
            <OrderAlertToggle on={alerts.on} enable={alerts.enable} disable={alerts.disable} />
            <Link to="/account" className="underline">My password</Link>
            <Link to="/admin/security" className="underline">Two-step</Link>
            <Link to="/" className="underline">Store</Link>
            <button type="button" className="cursor-pointer underline" onClick={() => signOut.mutate()}>Sign out</button>
          </div>
        </div>
        <nav aria-label="Dashboard" className="shell flex gap-6 overflow-x-auto">
          <NavLink to="/admin" end className={link}>Orders</NavLink>
          <NavLink to="/admin/transfers" className={link}>Transfers to check {badge(summary.data?.transfersToCheck)}</NavLink>
          <NavLink to="/admin/shop" className={link}>Shop</NavLink>
          <NavLink to="/admin/customers" className={link}>Customers</NavLink>
          <NavLink to="/admin/products" className={link}>Products &amp; stock {badge(summary.data?.lowStockVariants)}</NavLink>
          <NavLink to="/admin/looks" className={link}>Looks</NavLink>
          <NavLink to="/admin/promotions" className={link}>Offers</NavLink>
          <NavLink to="/admin/content" className={link}>Content</NavLink>
          <NavLink to="/admin/settings" className={link}>Settings</NavLink>
          {me.data.roles.includes("OWNER") && <NavLink to="/admin/reports" className={link}>Reports</NavLink>}
          {me.data.roles.includes("OWNER") && <NavLink to="/admin/staff" className={link}>Staff</NavLink>}
        </nav>
      </header>
      {alerts.fresh && <NewOrderBanner reference={alerts.fresh} onClose={alerts.dismiss} />}
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
