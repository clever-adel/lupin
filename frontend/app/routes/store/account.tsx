import { useQuery } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/account";
import { useRequireSignIn, useSignOut } from "~/features/auth/session";
import { api, ApiError } from "~/lib/http";
import { toLang, translate, useT, type MessageKey } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";
import type { OrderSummary, Page } from "~/lib/types";

export function meta({ params, matches, location }: Route.MetaArgs) {
  const title = translate(toLang(params.lang), "account.label");
  return seo({ origin: layoutOrigin(matches), pathname: location.pathname, title, description: title, noindex: true });
}

/** Private page: nothing personal is server-rendered; data is fetched in the browser with the session cookie. */
export default function Account() {
  const { t, href, money, dateTime } = useT();
  const me = useRequireSignIn(href("/sign-in"));
  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<Page<OrderSummary>>("GET", "/api/v1/orders?pageSize=20"),
    enabled: Boolean(me.data),
  });
  const signOut = useSignOut();

  if (me.isError) {
    return <p className="shell py-20 text-danger" role="alert">{t("error.generic")}</p>;
  }
  if (!me.data) {
    return <p className="shell py-20 text-stone" aria-busy="true">{t("auth.working")}</p>;
  }
  const user = me.data;
  const isStaff = user.roles.some((r) => r === "ADMIN" || r === "OWNER");

  return (
    <div className="shell max-w-3xl pt-10">
      {isStaff && (
        <Link to="/admin" className="mb-6 flex items-center justify-between border border-ink bg-card px-4 py-3 text-sm font-semibold">
          <span>{t("account.dashboard")}</span>
          <span aria-hidden="true" className="rtl:rotate-180">→</span>
        </Link>
      )}
      <p className="label text-stone">{t("account.label")}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
        <h1 className="display text-3xl">{t("account.hi", { name: user.fullName.split(" ")[0] ?? user.fullName })}</h1>
        <button type="button" className="btn btn-outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          {t("account.signOut")}
        </button>
      </div>

      <section className="mt-10" aria-labelledby="orders-title">
        <h2 id="orders-title" className="border-b border-line pb-3 text-sm font-semibold">{t("account.orders")}</h2>
        {orders.isPending ? (
          <p className="py-8 text-sm text-stone" aria-busy="true">{t("auth.working")}</p>
        ) : orders.isError ? (
          <p className="py-8 text-sm text-danger" role="alert">{t("error.generic")}</p>
        ) : orders.data.items.length === 0 ? (
          <p className="py-8 text-sm text-stone">{t("account.noOrders")}</p>
        ) : (
          <ul className="mb-8">
            {orders.data.items.map((order) => (
              <li key={order.reference} className="border-b border-line">
                <Link to={href(`/orders/${order.reference}`)} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-4 text-sm">
                  <span>
                    <span className="block font-semibold" dir="ltr">{order.reference}</span>
                    <span className="block text-xs text-stone">
                      {dateTime(order.placedAt)} · {t("order.itemsCount", { count: order.itemCount })}
                    </span>
                  </span>
                  <span className="text-end">
                    <span className="block font-bold">{money(order.total)}</span>
                    <span className="block text-xs text-stone">{t(`order.status.${order.status}` as MessageKey)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="details-title">
        <h2 id="details-title" className="border-b border-line pb-3 text-sm font-semibold">{t("account.details")}</h2>
        <dl className="grid gap-3 py-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-stone">{t("auth.fullName")}</dt>
            <dd>{user.fullName}</dd>
          </div>
          <div>
            <dt className="text-stone">{t("auth.email")}</dt>
            <dd dir="ltr" className="text-start">{user.email}</dd>
          </div>
        </dl>
      </section>

      <ChangePassword staff={isStaff} />
    </div>
  );
}

/** Changing the password ends every session, so the customer signs in again with the new one. */
function ChangePassword({ staff }: { staff: boolean }) {
  const { t, href, code } = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const minimum = staff ? 12 : 10;
  const change = useMutation({
    mutationFn: () => api<void>("POST", "/api/v1/auth/password", { currentPassword: current, newPassword: next }),
    // A full page load, not a client-side move: every cached private response is dropped with the
    // page, and no "you are signed out" redirect can race this one and lose the confirmation.
    onSuccess: () => window.location.replace(`${href("/sign-in")}?changed=1`),
  });
  const failure = change.error instanceof ApiError ? change.error : null;

  return (
    <section aria-labelledby="password-title">
      <h2 id="password-title" className="border-b border-line pb-3 text-sm font-semibold">{t("account.password")}</h2>
      <form
        noValidate
        className="grid gap-4 py-5 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (current && next.length >= minimum) change.mutate();
        }}
      >
        <div>
          <label htmlFor="current-password" className="mb-1.5 block text-sm font-medium">{t("account.currentPassword")}</label>
          <input id="current-password" type="password" dir="ltr" autoComplete="current-password" className="field" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium">{t("account.newPassword")}</label>
          <input id="new-password" type="password" dir="ltr" autoComplete="new-password" aria-describedby="new-password-hint" className="field" value={next} onChange={(e) => setNext(e.target.value)} />
          <p id="new-password-hint" className="mt-1 text-xs text-stone">{t("account.passwordHint", { count: minimum })}</p>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" className="btn btn-outline" disabled={change.isPending || !current || next.length < minimum}>
            {change.isPending ? t("auth.working") : t("account.password")}
          </button>
          {change.isError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {failure?.fields?.newPassword ?? code("err", failure?.code)}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
