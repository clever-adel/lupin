import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/checkout";
import { Field, SelectField } from "~/components/form";
import { useRequireSignIn } from "~/features/auth/session";
import { CART_KEY, useBag } from "~/features/bag/useBag";
import { checkoutSchema, type CheckoutValues } from "~/features/checkout/schema";
import { api, ApiError } from "~/lib/http";
import { toLang, translate, useT } from "~/lib/i18n";
import { layoutOrigin, seo } from "~/lib/seo";
import type { DeliveryOption, Governorate, Order, PaymentMethod, Quote, SiteContent } from "~/lib/types";

const METHOD_ORDER: PaymentMethod[] = ["CARD", "WALLET", "FAWRY", "INSTAPAY_MANUAL", "COD"];

export function meta({ params, matches, location }: Route.MetaArgs) {
  const title = translate(toLang(params.lang), "checkout.title");
  return seo({ origin: layoutOrigin(matches), pathname: location.pathname, title, description: title, noindex: true });
}

/** Private page. Every amount shown here is computed by the server; the browser only sends choices. */
export default function Checkout() {
  const { t, href, pick, money, code: codeText } = useT();
  const me = useRequireSignIn(href("/sign-in"));
  const navigate = useNavigate();
  const client = useQueryClient();
  const bag = useBag();

  const form = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: { recipientName: "", phone: "", governorateId: "", city: "", addressLine: "", notes: "" },
  });
  useEffect(() => {
    if (!me.data) return;
    if (!form.getValues("recipientName")) form.setValue("recipientName", me.data.fullName);
    if (!form.getValues("phone") && me.data.phone) form.setValue("phone", me.data.phone);
  }, [me.data, form]);

  const governorateId = Number(form.watch("governorateId")) || null;
  const [optionId, setOptionId] = useState<number | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [promoCode, setPromoCode] = useState("");
  // One key per attempt: a double click or a retried request can never create a second order.
  const idempotencyKey = useRef<string | null>(null);

  const site = useQuery({
    queryKey: ["site"],
    queryFn: () => api<SiteContent>("GET", "/api/v1/content/site"),
    staleTime: 300_000,
  });
  const governorates = useQuery({
    queryKey: ["governorates"],
    queryFn: () => api<Governorate[]>("GET", "/api/v1/delivery/governorates"),
    staleTime: 3_600_000,
  });
  const options = useQuery({
    queryKey: ["delivery-options", governorateId],
    queryFn: () => api<DeliveryOption[]>("GET", `/api/v1/delivery/options?governorateId=${governorateId}`),
    enabled: governorateId !== null,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (!options.data) return;
    setOptionId((current) => (options.data.some((o) => o.id === current) ? current : (options.data[0]?.id ?? null)));
  }, [options.data]);

  // Only methods the server says are usable right now; the server checks again when the order is placed.
  const methods = METHOD_ORDER.filter((m) => site.data?.paymentMethods[m] === true);
  const [chosenMethod, setChosenMethod] = useState<PaymentMethod | null>(null);
  const method = chosenMethod && methods.includes(chosenMethod) ? chosenMethod : methods[0];

  const signature = bag.items.map((i) => `${i.variantId}:${i.quantity}`).join(",");
  const quote = useQuery({
    queryKey: ["quote", signature, governorateId, optionId, promoCode],
    queryFn: () =>
      api<Quote>("POST", "/api/v1/checkout/quote", {
        governorateId,
        deliveryOptionId: governorateId === null ? null : optionId,
        promoCode: promoCode || null,
      }),
    enabled: bag.signedIn && bag.items.length > 0,
    placeholderData: keepPreviousData,
  });

  const place = useMutation({
    mutationFn: (values: CheckoutValues) => {
      idempotencyKey.current ??= crypto.randomUUID();
      return api<Order>("POST", "/api/v1/orders", {
        recipientName: values.recipientName,
        phone: values.phone,
        governorateId: Number(values.governorateId),
        city: values.city,
        addressLine: values.addressLine,
        notes: values.notes || null,
        deliveryOptionId: optionId,
        promoCode: quote.data?.promo?.applied ? promoCode : null,
        paymentMethod: method,
        expectedTotal: quote.data?.total,
        idempotencyKey: idempotencyKey.current,
      });
    },
    onSuccess: (order) => {
      client.setQueryData(CART_KEY, { lines: [], count: 0, subtotal: 0 });
      client.setQueryData(["order", order.reference], order);
      client.invalidateQueries({ queryKey: ["orders"] });
      // Online methods continue on the order page, which sends the customer to Paymob's hosted page.
      const next = order.paymentAction === "PAYMOB" ? "placed=1&pay=1" : "placed=1";
      navigate(`${href(`/orders/${order.reference}`)}?${next}`, { replace: true });
    },
    onError: () => {
      // Whatever went wrong, show the customer what the server says now.
      client.invalidateQueries({ queryKey: CART_KEY });
      client.invalidateQueries({ queryKey: ["quote"] });
    },
  });

  if (me.isError) {
    return <p className="shell py-20 text-danger" role="alert">{t("error.generic")}</p>;
  }
  if (!me.data || (bag.isPending && !place.isSuccess)) {
    return <p className="shell py-20 text-stone" aria-busy="true">{t("auth.working")}</p>;
  }
  if (bag.isEmpty && !place.isPending && !place.isSuccess) {
    return (
      <div className="shell py-20 text-center">
        <p className="text-stone">{t("bag.empty")}</p>
        <Link to={href("/shop")} className="btn btn-primary mt-6">{t("bag.continue")}</Link>
      </div>
    );
  }

  const q = quote.data;
  const failure = place.error instanceof ApiError ? place.error : null;
  // With no governorate chosen yet the button stays live so that pressing it shows what is missing.
  const canPlace =
    method !== undefined && !quote.isFetching && !place.isPending && (governorateId === null || Boolean(q?.readyToOrder));
  const heading = "border-b border-line pb-3 text-sm font-semibold";

  const applyCode = () => setPromoCode(codeInput.trim().toUpperCase());
  const removeCode = () => {
    setPromoCode("");
    setCodeInput("");
  };

  return (
    <div className="shell pt-10">
      <h1 className="display text-3xl md:text-4xl">{t("checkout.title")}</h1>

      <form
        noValidate
        className="mt-8 grid gap-10 lg:grid-cols-[1fr_24rem]"
        onSubmit={form.handleSubmit((values) => place.mutate(values))}
      >
        <div className="space-y-10">
          <section aria-labelledby="details-title">
            <h2 id="details-title" className={heading}>{t("checkout.details")}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label={t("checkout.name")} autoComplete="name" error={form.formState.errors.recipientName} serverError={failure?.fields?.recipientName} registration={form.register("recipientName")} />
              <Field label={t("checkout.phone")} type="tel" inputMode="tel" autoComplete="tel-national" error={form.formState.errors.phone} serverError={failure?.fields?.phone} registration={form.register("phone")} />
              <SelectField label={t("checkout.governorate")} autoComplete="address-level1" error={form.formState.errors.governorateId} registration={form.register("governorateId")}>
                <option value="">{t("checkout.chooseGovernorate")}</option>
                {(governorates.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>{pick(g, "name")}</option>
                ))}
              </SelectField>
              <Field label={t("checkout.city")} autoComplete="address-level2" error={form.formState.errors.city} serverError={failure?.fields?.city} registration={form.register("city")} />
              <div className="sm:col-span-2">
                <Field label={t("checkout.address")} autoComplete="street-address" error={form.formState.errors.addressLine} serverError={failure?.fields?.addressLine} registration={form.register("addressLine")} />
              </div>
              <div className="sm:col-span-2">
                <Field label={t("checkout.notes")} autoComplete="off" error={form.formState.errors.notes} serverError={failure?.fields?.notes} registration={form.register("notes")} />
              </div>
            </div>
          </section>

          <section aria-labelledby="delivery-title">
            <h2 id="delivery-title" className={heading}>{t("checkout.delivery")}</h2>
            {governorateId === null ? (
              <p className="py-5 text-sm text-stone">{t("checkout.chooseGovFirst")}</p>
            ) : options.isPending ? (
              <p className="py-5 text-sm text-stone" aria-busy="true">{t("auth.working")}</p>
            ) : options.isError ? (
              <p className="py-5 text-sm text-danger" role="alert">{t("error.generic")}</p>
            ) : options.data.length === 0 ? (
              <p className="py-5 text-sm text-danger" role="alert">{t("checkout.noDelivery")}</p>
            ) : (
              <fieldset className="mt-4 space-y-3">
                <legend className="sr-only">{t("checkout.delivery")}</legend>
                {options.data.map((o) => (
                  <label key={o.id} className={`flex cursor-pointer items-start gap-3 border bg-card p-4 ${optionId === o.id ? "border-ink" : "border-line"}`}>
                    <input type="radio" name="delivery" className="mt-1 accent-ink" checked={optionId === o.id} onChange={() => setOptionId(o.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{pick(o, "name")}</span>
                      <span className="block text-xs text-stone">{pick(o, "estimate")}</span>
                    </span>
                    <span className="shrink-0 text-sm font-bold">{o.fee === 0 ? t("checkout.free") : money(o.fee)}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </section>

          <section aria-labelledby="payment-title">
            <h2 id="payment-title" className={heading}>{t("checkout.payment")}</h2>
            {site.isPending ? (
              <p className="py-5 text-sm text-stone" aria-busy="true">{t("auth.working")}</p>
            ) : methods.length > 0 ? (
              <fieldset className="mt-4 space-y-3">
                <legend className="sr-only">{t("checkout.payment")}</legend>
                {methods.map((m) => (
                  <label key={m} className={`flex cursor-pointer items-start gap-3 border bg-card p-4 ${method === m ? "border-ink" : "border-line"}`}>
                    <input type="radio" name="payment" className="mt-1 accent-ink" checked={method === m} onChange={() => setChosenMethod(m)} />
                    <span>
                      <span className="block text-sm font-semibold">{t(`pay.${m}`)}</span>
                      <span className="block text-xs text-stone">{t(`pay.note.${m}`)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="py-5 text-sm text-danger" role="alert">{t("checkout.noPayment")}</p>
            )}
          </section>
        </div>

        <aside className="h-fit border border-line bg-card p-5" aria-labelledby="summary-title">
          <h2 id="summary-title" className="label">{t("checkout.summary")}</h2>

          <ul className="mt-4 space-y-3 border-b border-line pb-4">
            {(q?.lines ?? bag.items).map((line) => (
              <li key={line.variantId} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">{pick(line, "name")}</span>
                  <span className="block text-xs text-stone">
                    {pick(line, "color")} · <span dir="ltr">{line.sizeCode}</span> · {t("checkout.qty", { count: line.quantity })}
                  </span>
                </span>
                <span className="shrink-0">{money(line.lineTotal)}</span>
              </li>
            ))}
          </ul>

          <div className="border-b border-line py-4">
            <label htmlFor="promo" className="mb-1.5 block text-sm font-medium">{t("checkout.promo")}</label>
            <div className="flex gap-2">
              <input
                id="promo"
                className="field min-w-0 flex-1 uppercase"
                dir="ltr"
                maxLength={30}
                autoComplete="off"
                value={codeInput}
                readOnly={promoCode !== ""}
                onChange={(e) => setCodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyCode();
                  }
                }}
              />
              {promoCode ? (
                <button type="button" className="btn btn-outline" onClick={removeCode}>{t("checkout.removeCode")}</button>
              ) : (
                <button type="button" className="btn btn-outline" disabled={!codeInput.trim()} onClick={applyCode}>{t("checkout.apply")}</button>
              )}
            </div>
            <p className="mt-1.5 min-h-4 text-xs" aria-live="polite">
              {promoCode && q?.promo && !quote.isFetching &&
                (q.promo.applied ? (
                  <span>{t("checkout.promoApplied", { code: q.promo.code })}</span>
                ) : (
                  <span className="text-danger">{codeText("promo", q.promo.reason)}</span>
                ))}
            </p>
          </div>

          <dl className="space-y-2 py-4 text-sm" aria-live="polite" aria-busy={quote.isFetching}>
            <div className="flex justify-between">
              <dt>{t("bag.subtotal")}</dt>
              <dd>{q ? money(q.subtotal) : "…"}</dd>
            </div>
            {q && q.discount > 0 && (
              <div className="flex justify-between gap-3">
                <dt>
                  {t("checkout.discount")}
                  {pick(q, "discountLabel") && <span className="block text-xs text-stone">{pick(q, "discountLabel")}</span>}
                </dt>
                <dd>−{money(q.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>{t("checkout.deliveryFee")}</dt>
              <dd>{q?.delivery ? (q.delivery.free ? t("checkout.free") : money(q.delivery.fee)) : "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <dt className="font-semibold">{t("checkout.total")}</dt>
              <dd className="text-lg font-bold">{q ? money(q.total) : "…"}</dd>
            </div>
          </dl>

          {q && q.issues.filter((i) => i.code !== "DELIVERY_UNAVAILABLE").length > 0 && (
            <div role="alert" className="mb-4 border border-danger px-3 py-2 text-sm text-danger">
              <p>{codeText("err", "BAG_CHANGED")}</p>
              <Link to={href("/bag")} className="underline">{t("checkout.backToBag")}</Link>
            </div>
          )}
          {quote.isError && <p role="alert" className="mb-4 text-sm text-danger">{t("error.generic")}</p>}
          {place.isError && (
            <p role="alert" className="mb-4 border border-danger px-3 py-2 text-sm text-danger">
              {failure?.fields ? codeText("err", undefined) : codeText("err", failure?.code)}
            </p>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={!canPlace}>
            {place.isPending ? t("checkout.placing") : t("checkout.place")}
          </button>
          <Link to={href("/bag")} className="mt-4 block text-center text-sm underline">{t("checkout.backToBag")}</Link>
        </aside>
      </form>
    </div>
  );
}
