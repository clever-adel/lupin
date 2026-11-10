import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { Route } from "./+types/account";
import { useRequireSignIn, useSignOut } from "~/features/auth/session";
import { api } from "~/lib/http";
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

  return (
    <div className="shell max-w-3xl pt-10">
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
    </div>
  );
}
