import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOutletContext } from "react-router";
import type { AdminContext } from "./layout";
import { errorText } from "~/features/admin/shared";
import { api, deleteUploadedImage, uploadImages } from "~/lib/http";

interface Policy {
  slug: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  status: "DRAFT" | "PUBLISHED";
}

interface Faq {
  id: number;
  questionEn: string;
  questionAr: string;
  answerEn: string;
  answerAr: string;
  sortOrder: number;
  published: boolean;
}

type Settings = Record<string, Record<string, unknown>>;
const label = "mb-1 block text-xs font-medium";

function PolicyEditor({ policy, isOwner }: { policy: Policy; isOwner: boolean }) {
  const client = useQueryClient();
  const [titleEn, setTitleEn] = useState(policy.titleEn);
  const [titleAr, setTitleAr] = useState(policy.titleAr);
  const [bodyEn, setBodyEn] = useState(policy.bodyEn);
  const [bodyAr, setBodyAr] = useState(policy.bodyAr);
  const live = policy.status === "PUBLISHED";
  const locked = live && !isOwner;
  const base = `/api/v1/admin/policies/${policy.slug}`;
  const refresh = () => client.invalidateQueries({ queryKey: ["admin", "policies"] });

  const save = useMutation({ mutationFn: () => api("PUT", base, { titleEn, titleAr, bodyEn, bodyAr }), onSuccess: refresh });
  // Publishing always saves first, so what goes live is exactly what is on screen.
  const publish = useMutation({
    mutationFn: async (action: "publish" | "unpublish") => {
      if (action === "publish") await api("PUT", base, { titleEn, titleAr, bodyEn, bodyAr });
      await api("POST", `${base}/${action}`, {});
    },
    onSuccess: refresh,
  });
  const busy = save.isPending || publish.isPending;
  const failure = save.error ?? publish.error;

  return (
    <details className="border-b border-line py-3">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{policy.titleEn}</span>
        <span className={`text-xs ${live ? "font-semibold" : "text-stone"}`}>
          {live ? "Customers can read it" : policy.bodyEn ? "Draft, hidden" : "Empty, hidden"}
        </span>
      </summary>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`ten-${policy.slug}`} className={label}>Title (English)</label>
            <input id={`ten-${policy.slug}`} className="field" maxLength={120} value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`tar-${policy.slug}`} className={label}>Title (Arabic)</label>
            <input id={`tar-${policy.slug}`} className="field" dir="rtl" maxLength={120} value={titleAr} onChange={(e) => setTitleAr(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`ben-${policy.slug}`} className={label}>Text (English). Leave an empty line between paragraphs.</label>
            <textarea id={`ben-${policy.slug}`} className="field h-56 py-2" value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`bar-${policy.slug}`} className={label}>Text (Arabic)</label>
            <textarea id={`bar-${policy.slug}`} className="field h-56 py-2" dir="rtl" value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} />
          </div>
        </fieldset>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {locked ? (
            <p className="text-sm text-stone">Only the owner can change a policy that customers can already read.</p>
          ) : (
            <button type="submit" className="btn btn-outline" disabled={busy}>
              {live ? "Save and update the live policy" : "Save draft"}
            </button>
          )}
          {isOwner && !live && (
            <button type="button" className="btn btn-primary" disabled={busy || !bodyEn.trim() || !bodyAr.trim()} onClick={() => publish.mutate("publish")}>
              Save and publish
            </button>
          )}
          {isOwner && live && (
            <button type="button" className="cursor-pointer text-sm underline" disabled={busy} onClick={() => publish.mutate("unpublish")}>
              Take down
            </button>
          )}
          {!isOwner && !live && <span className="text-sm text-stone">The owner publishes policies.</span>}
          {(save.isSuccess || publish.isSuccess) && !failure && <span role="status" className="text-sm">Saved.</span>}
          {failure && <span role="alert" className="text-sm text-danger">{errorText(failure)}</span>}
        </div>
      </form>
    </details>
  );
}

function FaqEditor({ item }: { item: Faq | null }) {
  const client = useQueryClient();
  const [questionEn, setQuestionEn] = useState(item?.questionEn ?? "");
  const [questionAr, setQuestionAr] = useState(item?.questionAr ?? "");
  const [answerEn, setAnswerEn] = useState(item?.answerEn ?? "");
  const [answerAr, setAnswerAr] = useState(item?.answerAr ?? "");
  const [published, setPublished] = useState(item?.published ?? true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const uid = item?.id ?? "new";
  const refresh = () => client.invalidateQueries({ queryKey: ["admin", "faq"] });

  const save = useMutation({
    mutationFn: () => {
      const body = { questionEn, questionAr, answerEn, answerAr, sortOrder: item?.sortOrder ?? 99, published };
      return item ? api("PUT", `/api/v1/admin/faq/${item.id}`, body) : api("POST", "/api/v1/admin/faq", body);
    },
    onSuccess: () => {
      refresh();
      if (!item) {
        setQuestionEn(""); setQuestionAr(""); setAnswerEn(""); setAnswerAr("");
      }
    },
  });
  const remove = useMutation({ mutationFn: () => api("DELETE", `/api/v1/admin/faq/${item?.id}`), onSuccess: refresh });
  const ready = questionEn.trim() && questionAr.trim() && answerEn.trim() && answerAr.trim();

  return (
    <form
      className="border-b border-line py-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`qen-${uid}`} className={label}>Question (English)</label>
          <input id={`qen-${uid}`} className="field" maxLength={300} value={questionEn} onChange={(e) => setQuestionEn(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`qar-${uid}`} className={label}>Question (Arabic)</label>
          <input id={`qar-${uid}`} className="field" dir="rtl" maxLength={300} value={questionAr} onChange={(e) => setQuestionAr(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`aen-${uid}`} className={label}>Answer (English)</label>
          <textarea id={`aen-${uid}`} className="field h-24 py-2" value={answerEn} onChange={(e) => setAnswerEn(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`aar-${uid}`} className={label}>Answer (Arabic)</label>
          <textarea id={`aar-${uid}`} className="field h-24 py-2" dir="rtl" value={answerAr} onChange={(e) => setAnswerAr(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-ink" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Shown to customers
        </label>
        <button type="submit" className="btn btn-outline" disabled={!ready || save.isPending}>{item ? "Save" : "Add question"}</button>
        {item &&
          (confirmDelete ? (
            <>
              <button type="button" className="btn btn-primary" disabled={remove.isPending} onClick={() => remove.mutate()}>Yes, delete it</button>
              <button type="button" className="cursor-pointer text-sm underline" onClick={() => setConfirmDelete(false)}>Keep</button>
            </>
          ) : (
            <button type="button" className="cursor-pointer text-sm underline" onClick={() => setConfirmDelete(true)}>Delete</button>
          ))}
        {save.isSuccess && <span role="status" className="text-sm">Saved.</span>}
        {(save.isError || remove.isError) && <span role="alert" className="text-sm text-danger">{errorText(save.error ?? remove.error)}</span>}
      </div>
    </form>
  );
}

/** A plain form over one settings row: each listed field is a text box. */
function TextSettings({ settingKey, value, fields }: { settingKey: string; value: Record<string, unknown>; fields: [string, string, boolean?][] }) {
  const client = useQueryClient();
  const [state, setState] = useState<Record<string, string>>(Object.fromEntries(fields.map(([name]) => [name, String(value[name] ?? "")])));
  const save = useMutation({
    mutationFn: () => api("PUT", `/api/v1/admin/settings/${settingKey}`, state),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "settings"] }),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([name, text, rtl]) => (
          <div key={name}>
            <label htmlFor={`${settingKey}-${name}`} className={label}>{text}</label>
            <input id={`${settingKey}-${name}`} className="field" dir={rtl ? "rtl" : undefined} maxLength={500} value={state[name] ?? ""} onChange={(e) => setState({ ...state, [name]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" className="btn btn-outline" disabled={save.isPending}>Save</button>
        {save.isSuccess && <span role="status" className="text-sm">Saved. Customers see it on their next page load.</span>}
        {save.isError && <span role="alert" className="text-sm text-danger">{errorText(save.error)}</span>}
      </div>
    </form>
  );
}

/**
 * The big photo at the top of the home page. Uploading replaces it straight away (the old file is then
 * removed from storage); removing it falls back to the first featured product's main photo.
 */
function HomePhoto({ value }: { value: Record<string, unknown> }) {
  const client = useQueryClient();
  const current = typeof value.imageUrl === "string" && value.imageUrl ? value.imageUrl : "";
  const currentId = typeof value.imagePublicId === "string" ? value.imagePublicId : "";
  const [error, setError] = useState("");

  const replace = useMutation({
    mutationFn: async (file: File | null) => {
      let next = { imageUrl: "", imagePublicId: "" };
      if (file) {
        const [uploaded] = await uploadImages([file]);
        if (!uploaded) throw new Error("Could not upload the photo.");
        next = { imageUrl: uploaded.url, imagePublicId: uploaded.publicId };
      }
      try {
        await api("PUT", "/api/v1/admin/settings/hero", next);
      } catch (e) {
        if (next.imagePublicId) await deleteUploadedImage(next.imagePublicId).catch(() => undefined);
        throw e;
      }
      // The old file is no longer used anywhere; a failed clean-up only leaves an unused file behind.
      if (currentId) await deleteUploadedImage(currentId).catch(() => undefined);
    },
    onMutate: () => setError(""),
    onError: (e) => setError(e instanceof Error ? e.message : errorText(e)),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "settings"] }),
  });

  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="grid aspect-[4/5] w-40 place-items-center overflow-hidden bg-studio text-center text-xs text-stone">
        {current ? (
          <img src={current} alt="Current home page photo" className="h-full w-full object-cover" />
        ) : (
          <span className="px-3">No photo chosen: the first featured product’s photo is shown.</span>
        )}
      </div>
      <div className="max-w-sm space-y-3 text-sm">
        <p className="text-stone">
          Best: a tall photo (4 by 5), at least 1200 pixels wide, of a model on a plain light grey background, like
          your product photos. It is shown next to the headline and links to the shop.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className={`btn btn-primary ${replace.isPending ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
            {replace.isPending ? "Saving…" : current ? "Change photo" : "Choose photo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              disabled={replace.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) replace.mutate(file);
              }}
            />
          </label>
          {current && (
            <button type="button" className="cursor-pointer underline" disabled={replace.isPending} onClick={() => replace.mutate(null)}>
              Remove photo
            </button>
          )}
        </div>
        {replace.isSuccess && !error && <p role="status">Saved. Customers see it on their next page load.</p>}
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </div>
  );
}

export default function AdminContent() {
  const { isOwner } = useOutletContext<AdminContext>();
  const policies = useQuery({ queryKey: ["admin", "policies"], queryFn: () => api<Policy[]>("GET", "/api/v1/admin/policies") });
  const faq = useQuery({ queryKey: ["admin", "faq"], queryFn: () => api<Faq[]>("GET", "/api/v1/admin/faq") });
  const settings = useQuery({ queryKey: ["admin", "settings"], queryFn: () => api<Settings>("GET", "/api/v1/admin/settings") });

  if (policies.isError || faq.isError || settings.isError) return <p className="text-danger" role="alert">Could not load content.</p>;
  if (!policies.data || !faq.data || !settings.data) return <p className="text-stone" aria-busy="true">Loading…</p>;
  const box = "border border-line bg-card p-5";

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="display text-2xl">Content</h1>

      <section className={box}>
        <h2 className="font-semibold">Home page photo</h2>
        <div className="mt-4">
          <HomePhoto value={settings.data.hero ?? {}} />
        </div>
      </section>

      <section className={box}>
        <h2 className="font-semibold">Home page headline</h2>
        <p className="mt-1 text-sm text-stone">Leave the headline empty to show the brand line “Steal the look.”</p>
        <div className="mt-4">
          <TextSettings
            settingKey="hero"
            value={settings.data.hero ?? {}}
            fields={[
              ["labelEn", "Small label (English)"], ["labelAr", "Small label (Arabic)", true],
              ["headlineEn", "Headline (English)"], ["headlineAr", "Headline (Arabic)", true],
              ["textEn", "Text under it (English)"], ["textAr", "Text under it (Arabic)", true],
            ]}
          />
        </div>
      </section>

      <section className={box}>
        <h2 className="font-semibold">Contact details in the footer</h2>
        <p className="mt-1 text-sm text-stone">Empty fields are not shown. Social links must start with https://</p>
        <div className="mt-4">
          <TextSettings
            settingKey="contact"
            value={settings.data.contact ?? {}}
            fields={[
              ["phone", "Phone"], ["email", "Email"],
              ["hoursEn", "Working hours (English)"], ["hoursAr", "Working hours (Arabic)", true],
              ["instagram", "Instagram link"], ["facebook", "Facebook link"], ["tiktok", "TikTok link"],
            ]}
          />
        </div>
      </section>

      <section className={box}>
        <h2 className="font-semibold">Policies</h2>
        <p className="mt-1 text-sm text-stone">
          Staff can prepare drafts. Only the owner publishes a policy or changes one customers can already read.
        </p>
        <div className="mt-3 border-t border-line">
          {policies.data.map((p) => <PolicyEditor key={p.slug} policy={p} isOwner={isOwner} />)}
        </div>
      </section>

      <section className={box}>
        <h2 className="font-semibold">Questions &amp; answers</h2>
        <div className="mt-3 border-t border-line">
          {faq.data.map((item) => <FaqEditor key={item.id} item={item} />)}
        </div>
        <h3 className="pt-4 text-sm font-semibold">Add a question</h3>
        <FaqEditor item={null} />
      </section>
    </div>
  );
}
