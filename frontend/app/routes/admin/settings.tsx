import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useOutletContext } from "react-router";
import type { AdminContext } from "./layout";
import { errorText, PAYMENT_LABEL, type AdminDeliveryOption, type GovernorateFee } from "~/features/admin/shared";
import { api } from "~/lib/http";
import type { Governorate, PaymentMethod, SiteContent } from "~/lib/types";

type Settings = Record<string, Record<string, unknown>>;
const METHODS: PaymentMethod[] = ["COD", "INSTAPAY_MANUAL", "CARD", "WALLET", "FAWRY"];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border border-line bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-stone">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SaveRow({ pending, error, saved, disabled }: { pending: boolean; error: unknown; saved: boolean; disabled?: boolean }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="submit" className="btn btn-primary" disabled={pending || disabled}>{pending ? "Saving…" : "Save"}</button>
      {saved && <span role="status" className="text-sm">Saved.</span>}
      {error ? <span role="alert" className="text-sm text-danger">{errorText(error)}</span> : null}
    </div>
  );
}

/** Saves a few fields of one settings row; the server refuses unknown fields and wrong kinds of value. */
function useSaveSetting(key: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api("PUT", `/api/v1/admin/settings/${key}`, body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin", "settings"] });
      client.invalidateQueries({ queryKey: ["site"] });
    },
  });
}

function DeliveryOptionForm({ option, governorates }: { option: AdminDeliveryOption | null; governorates: Governorate[] }) {
  const client = useQueryClient();
  const [nameEn, setNameEn] = useState(option?.nameEn ?? "");
  const [nameAr, setNameAr] = useState(option?.nameAr ?? "");
  const [estimateEn, setEstimateEn] = useState(option?.estimateEn ?? "");
  const [estimateAr, setEstimateAr] = useState(option?.estimateAr ?? "");
  const [fee, setFee] = useState(option ? String(option.fee) : "");
  const [active, setActive] = useState(option?.active ?? false);
  const [limited, setLimited] = useState<GovernorateFee[]>(option?.governorates ?? []);
  const uid = option?.id ?? "new";

  const save = useMutation({
    mutationFn: () => {
      const body = {
        type: option?.type ?? "STANDARD",
        nameEn, nameAr, estimateEn, estimateAr,
        fee: Number(fee),
        active,
        sortOrder: option?.sortOrder ?? 99,
        governorates: limited,
      };
      return option
        ? api("PUT", `/api/v1/admin/delivery/options/${option.id}`, body)
        : api("POST", "/api/v1/admin/delivery/options", body);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["admin", "delivery"] });
      if (!option) {
        setNameEn(""); setNameAr(""); setEstimateEn(""); setEstimateAr(""); setFee(""); setActive(false); setLimited([]);
      }
    },
  });
  const feeOk = fee.trim() !== "" && Number(fee) >= 0;
  const toggle = (id: number) =>
    setLimited((list) => (list.some((g) => g.governorateId === id) ? list.filter((g) => g.governorateId !== id) : [...list, { governorateId: id }]));
  const setOverride = (id: number, value: string) =>
    setLimited((list) => list.map((g) => (g.governorateId === id ? { governorateId: id, feeOverride: value.trim() === "" ? null : Number(value) } : g)));

  return (
    <form
      className="border-t border-line py-4 first:border-0 first:pt-0"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label htmlFor={`en-${uid}`} className="mb-1 block text-xs font-medium">Name (English)</label>
          <input id={`en-${uid}`} className="field" required maxLength={80} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`ar-${uid}`} className="mb-1 block text-xs font-medium">Name (Arabic)</label>
          <input id={`ar-${uid}`} className="field" dir="rtl" required maxLength={80} value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`een-${uid}`} className="mb-1 block text-xs font-medium">Delivery time (English)</label>
          <input id={`een-${uid}`} className="field" maxLength={80} value={estimateEn} onChange={(e) => setEstimateEn(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`ear-${uid}`} className="mb-1 block text-xs font-medium">Delivery time (Arabic)</label>
          <input id={`ear-${uid}`} className="field" dir="rtl" maxLength={80} value={estimateAr} onChange={(e) => setEstimateAr(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`fee-${uid}`} className="mb-1 block text-xs font-medium">Fee (EGP)</label>
          <input id={`fee-${uid}`} className="field" inputMode="decimal" required value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer">
          {limited.length === 0 ? "Offered in every governorate at this fee" : `Offered in ${limited.length} governorate(s) only`}
        </summary>
        <p className="mt-2 text-xs text-stone">
          Tick governorates to offer this option only there. Leave all unticked to offer it everywhere. A fee next
          to a ticked governorate replaces the fee above for that governorate.
        </p>
        <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {governorates.map((g) => {
            const chosen = limited.find((x) => x.governorateId === g.id);
            return (
              <li key={g.id} className="flex items-center gap-2">
                <input id={`g-${uid}-${g.id}`} type="checkbox" className="accent-ink" checked={Boolean(chosen)} onChange={() => toggle(g.id)} />
                <label htmlFor={`g-${uid}-${g.id}`} className="flex-1">{g.nameEn}</label>
                {chosen && (
                  <input
                    aria-label={`Fee in ${g.nameEn}`}
                    className="field h-8 w-20"
                    inputMode="decimal"
                    placeholder="same"
                    value={chosen.feeOverride ?? ""}
                    onChange={(e) => setOverride(g.id, e.target.value)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-ink" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Shown to customers
        </label>
        <button type="submit" className="btn btn-outline" disabled={save.isPending || !feeOk}>
          {save.isPending ? "Saving…" : option ? "Save" : "Add delivery option"}
        </button>
        {save.isSuccess && <span role="status" className="text-sm">Saved.</span>}
        {save.isError && <span role="alert" className="text-sm text-danger">{errorText(save.error)}</span>}
      </div>
    </form>
  );
}

function PaymentForm({ value, isOwner }: { value: Record<string, unknown>; isOwner: boolean }) {
  const save = useSaveSetting("payment_methods");
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(METHODS.map((m) => [m, value[m] === true])));
  const [handle, setHandle] = useState(String(value.instapayHandle ?? ""));
  const [noteEn, setNoteEn] = useState(String(value.instapayInstructionsEn ?? ""));
  const [noteAr, setNoteAr] = useState(String(value.instapayInstructionsAr ?? ""));
  // What customers really get: a switch is not enough if Paymob keys or the InstaPay address are missing.
  const site = useQuery({ queryKey: ["site"], queryFn: () => api<SiteContent>("GET", "/api/v1/content/site") });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ ...on, instapayHandle: handle.trim(), instapayInstructionsEn: noteEn, instapayInstructionsAr: noteAr });
      }}
    >
      <fieldset disabled={!isOwner} className="space-y-2">
        <legend className="sr-only">Payment methods</legend>
        {METHODS.map((m) => {
          const live = site.data?.paymentMethods[m];
          return (
            <label key={m} className="flex flex-wrap items-center gap-2 text-sm">
              <input type="checkbox" className="accent-ink" checked={on[m] ?? false} onChange={(e) => setOn({ ...on, [m]: e.target.checked })} />
              <span className="font-medium">{PAYMENT_LABEL[m]}</span>
              {value[m] === true && live === false && (
                <span className="text-xs text-danger">
                  switched on, but customers cannot use it: {m === "INSTAPAY_MANUAL" ? "the InstaPay address is missing" : "Paymob is not set up on the server"}
                </span>
              )}
              {live === true && <span className="text-xs text-stone">customers can use it</span>}
            </label>
          );
        })}
        <div className="grid gap-3 pt-3 sm:grid-cols-3">
          <div>
            <label htmlFor="ip-handle" className="mb-1 block text-xs font-medium">InstaPay address customers send money to</label>
            <input id="ip-handle" className="field" dir="ltr" maxLength={100} value={handle} onChange={(e) => setHandle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ip-en" className="mb-1 block text-xs font-medium">Transfer instructions (English)</label>
            <input id="ip-en" className="field" maxLength={500} value={noteEn} onChange={(e) => setNoteEn(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ip-ar" className="mb-1 block text-xs font-medium">Transfer instructions (Arabic)</label>
            <input id="ip-ar" className="field" dir="rtl" maxLength={500} value={noteAr} onChange={(e) => setNoteAr(e.target.value)} />
          </div>
        </div>
      </fieldset>
      {isOwner ? (
        <SaveRow pending={save.isPending} error={save.error} saved={save.isSuccess} />
      ) : (
        <p className="mt-4 text-sm text-stone">Only the owner can change payment settings.</p>
      )}
    </form>
  );
}

function CheckoutForm({ value, isOwner }: { value: Record<string, unknown>; isOwner: boolean }) {
  const save = useSaveSetting("checkout");
  const [threshold, setThreshold] = useState(value.freeDeliveryThreshold == null ? "" : String(value.freeDeliveryThreshold));
  const [undo, setUndo] = useState(String(value.cancelUndoMinutes ?? 30));
  const [unpaid, setUnpaid] = useState(String(value.unpaidOrderMinutes ?? 60));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          freeDeliveryThreshold: threshold.trim() === "" ? null : Number(threshold),
          cancelUndoMinutes: Number(undo),
          unpaidOrderMinutes: Number(unpaid),
        });
      }}
    >
      <fieldset disabled={!isOwner} className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="threshold" className="mb-1 block text-xs font-medium">Free delivery from (EGP, empty = never)</label>
          <input id="threshold" className="field" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </div>
        <div>
          <label htmlFor="undo" className="mb-1 block text-xs font-medium">Minutes a customer can undo a cancel</label>
          <input id="undo" className="field" inputMode="numeric" value={undo} onChange={(e) => setUndo(e.target.value)} />
        </div>
        <div>
          <label htmlFor="unpaid" className="mb-1 block text-xs font-medium">Minutes before an unpaid online order is cancelled</label>
          <input id="unpaid" className="field" inputMode="numeric" value={unpaid} onChange={(e) => setUnpaid(e.target.value)} />
        </div>
      </fieldset>
      {isOwner ? (
        <SaveRow pending={save.isPending} error={save.error} saved={save.isSuccess} />
      ) : (
        <p className="mt-4 text-sm text-stone">Only the owner can change these.</p>
      )}
    </form>
  );
}

function AnnouncementForm({ value }: { value: Record<string, unknown> }) {
  const save = useSaveSetting("announcement");
  const lines = (v: unknown) => (Array.isArray(v) ? v.join("\n") : "");
  const [en, setEn] = useState(lines(value.itemsEn));
  const [ar, setAr] = useState(lines(value.itemsAr));
  const split = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ itemsEn: split(en), itemsAr: split(ar) });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ann-en" className="mb-1 block text-xs font-medium">English, one message per line</label>
          <textarea id="ann-en" className="field h-24 py-2" value={en} onChange={(e) => setEn(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ann-ar" className="mb-1 block text-xs font-medium">Arabic, one message per line</label>
          <textarea id="ann-ar" className="field h-24 py-2" dir="rtl" value={ar} onChange={(e) => setAr(e.target.value)} />
        </div>
      </div>
      <SaveRow pending={save.isPending} error={save.error} saved={save.isSuccess} />
    </form>
  );
}

export default function AdminSettings() {
  const { isOwner } = useOutletContext<AdminContext>();
  const settings = useQuery({ queryKey: ["admin", "settings"], queryFn: () => api<Settings>("GET", "/api/v1/admin/settings") });
  const delivery = useQuery({
    queryKey: ["admin", "delivery"],
    queryFn: () => api<AdminDeliveryOption[]>("GET", "/api/v1/admin/delivery/options"),
  });
  const governorates = useQuery({
    queryKey: ["governorates"],
    queryFn: () => api<Governorate[]>("GET", "/api/v1/delivery/governorates"),
    staleTime: 3_600_000,
  });

  if (settings.isError || delivery.isError || governorates.isError) {
    return <p className="text-danger" role="alert">Could not load settings.</p>;
  }
  if (!settings.data || !delivery.data || !governorates.data) {
    return <p className="text-stone" aria-busy="true">Loading…</p>;
  }

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="display text-2xl">Settings</h1>

      <Section title="Delivery options and fees" hint="Customers choose one of these at checkout. Every change is recorded with your name.">
        {delivery.data.map((option) => (
          <DeliveryOptionForm key={option.id} option={option} governorates={governorates.data} />
        ))}
        <h3 className="border-t border-line pt-4 text-sm font-semibold">Add a delivery option</h3>
        <div className="mt-3">
          <DeliveryOptionForm option={null} governorates={governorates.data} />
        </div>
      </Section>

      <Section title="Payment methods" hint="Decides how customers can pay and where transfers are sent.">
        <PaymentForm value={settings.data.payment_methods ?? {}} isOwner={isOwner} />
      </Section>

      <Section title="Checkout rules">
        <CheckoutForm value={settings.data.checkout ?? {}} isOwner={isOwner} />
      </Section>

      <Section title="Announcement bar" hint="Saved now; the bar itself is not shown on the storefront yet.">
        <AnnouncementForm value={settings.data.announcement ?? {}} />
      </Section>
    </div>
  );
}
