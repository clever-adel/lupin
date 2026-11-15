import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  errorText,
  ROLE_LABEL,
  type AdminLook,
  type AdminProduct,
  type AiStatus,
  type LookGeneration,
  type LookRole,
} from "~/features/admin/shared";
import { api, ApiError, deleteUploadedImage, uploadImages } from "~/lib/http";
import type { Page } from "~/lib/types";

/** A piece being edited. Names and photos are kept only to show staff what they picked. */
interface Piece {
  productId: number;
  productName: string;
  productStatus: string;
  colorId: number;
  role: LookRole;
  colours: { id: number; nameEn: string; hex: string; imageUrl?: string }[];
}

interface ProductForEdit {
  id: number;
  nameEn: string;
  status: string;
  categorySlug: string;
  colors: { id: number; nameEn: string; hex: string; images: { url: string }[] }[];
}

const MAX_PIECES = 8;

/** A first guess from the category name; staff can always change it. */
function guessRole(category: string): LookRole {
  const c = category.toLowerCase();
  if (/(trouser|pant|jean|short|jogger|chino|cargo|bottom)/.test(c)) return "BOTTOM";
  if (/(jacket|coat|bomber|blazer|outer|parka|vest|gilet)/.test(c)) return "OUTER";
  if (/(shoe|sneaker|boot|bag|belt|cap|hat|watch|sock|accessor|scarf|glass)/.test(c)) return "ACCESSORY";
  if (/(set|suit|jumpsuit|overall)/.test(c)) return "ONE_PIECE";
  return "TOP";
}

async function loadProduct(id: number): Promise<Piece> {
  const p = await api<ProductForEdit>("GET", `/api/v1/admin/products/${id}`);
  const colours = p.colors.map((c) => ({ id: c.id, nameEn: c.nameEn, hex: c.hex, imageUrl: c.images[0]?.url }));
  return {
    productId: p.id,
    productName: p.nameEn,
    productStatus: p.status,
    colorId: colours[0]!.id,
    role: guessRole(p.categorySlug),
    colours,
  };
}

export default function AdminLookEditor() {
  const { id: param } = useParams();
  const isNew = param === "new";
  const id = isNew ? null : Number(param);
  const client = useQueryClient();
  const navigate = useNavigate();

  const look = useQuery({
    queryKey: ["admin", "look", id],
    queryFn: () => api<AdminLook>("GET", `/api/v1/admin/looks/${id}`),
    enabled: id !== null,
  });

  const [form, setForm] = useState({ titleEn: "", titleAr: "", descriptionEn: "", descriptionAr: "", sortOrder: 0 });
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [loaded, setLoaded] = useState(isNew);

  // Fill the form once from the server, with every colour of each product for the colour picker.
  useEffect(() => {
    if (!look.data || loaded) return;
    const data = look.data;
    setForm({ titleEn: data.titleEn, titleAr: data.titleAr, descriptionEn: data.descriptionEn, descriptionAr: data.descriptionAr, sortOrder: data.sortOrder });
    Promise.all(data.items.map((item) => loadProduct(item.productId).then((p) => ({ ...p, colorId: item.colorId, role: item.role }))))
      .then((list) => {
        setPieces(list);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [look.data, loaded]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...form, items: pieces.map((p) => ({ productId: p.productId, colorId: p.colorId, role: p.role })) };
      if (id === null) return api<{ id: number }>("POST", "/api/v1/admin/looks", body);
      await api<void>("PUT", `/api/v1/admin/looks/${id}`, body);
      return { id };
    },
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ["admin", "looks"] });
      if (id === null) {
        navigate(`/admin/looks/${result.id}`, { replace: true });
      } else {
        // Changing the pieces removes the photo on the server; the old file goes from storage too.
        const before = look.data;
        const fresh = await client.fetchQuery({ queryKey: ["admin", "look", id], queryFn: () => api<AdminLook>("GET", `/api/v1/admin/looks/${id}`) });
        if (before?.imagePublicId && !fresh.imagePublicId) void deleteUploadedImage(before.imagePublicId).catch(() => undefined);
      }
    },
  });

  if (look.isError) return <p role="alert" className="text-danger">{errorText(look.error)}</p>;
  if (!loaded) return <p className="text-stone" aria-busy="true">Loading…</p>;

  const piecesChanged =
    !!look.data &&
    JSON.stringify(look.data.items.map((i) => [i.productId, i.colorId, i.role])) !==
      JSON.stringify(pieces.map((p) => [p.productId, p.colorId, p.role]));
  const ready = form.titleEn.trim() && form.titleAr.trim() && pieces.length > 0;

  return (
    <div className="max-w-5xl">
      <Link to="/admin/looks" className="text-sm underline">← All looks</Link>
      <h1 className="display mt-4 text-2xl">{isNew ? "New look" : form.titleEn || "Look"}</h1>

      <form
        className="mt-8 space-y-10"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) save.mutate();
        }}
      >
        <section className="grid gap-4 sm:grid-cols-2" aria-label="Details">
          <Field id="titleEn" label="Title (English)" value={form.titleEn} onChange={(v) => setForm({ ...form, titleEn: v })} required />
          <Field id="titleAr" label="Title (Arabic)" value={form.titleAr} onChange={(v) => setForm({ ...form, titleAr: v })} rtl required />
          <Field id="descEn" label="Short description (English, optional)" value={form.descriptionEn} onChange={(v) => setForm({ ...form, descriptionEn: v })} area />
          <Field id="descAr" label="Short description (Arabic, optional)" value={form.descriptionAr} onChange={(v) => setForm({ ...form, descriptionAr: v })} rtl area />
          <div>
            <label htmlFor="sort" className="mb-1 block text-xs font-medium">Order on the store (lowest first)</label>
            <input id="sort" type="number" min={0} max={10000} className="field w-32" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })} />
          </div>
        </section>

        <section aria-labelledby="pieces-title">
          <h2 id="pieces-title" className="text-lg font-semibold">What the model wears</h2>
          <p className="mt-1 text-sm text-stone">
            Pick the products and the colour shown in the photo. The AI dresses the model in tops, bottoms, one-pieces and outer
            layers using each colour’s first product photo; accessories are listed for customers but not drawn.
          </p>
          <PieceList pieces={pieces} setPieces={setPieces} />
          {pieces.length < MAX_PIECES && <ProductPicker exclude={pieces.map((p) => p.productId)} onPick={(p) => setPieces((list) => [...list, p])} />}
        </section>

        {piecesChanged && look.data?.imageUrl && (
          <p className="border border-danger p-3 text-sm text-danger" role="status">
            Saving changes to the pieces removes the current photo and takes the look off the store, because the photo would no
            longer match. You will need a new photo.
          </p>
        )}
        {save.isError && <p role="alert" className="text-sm text-danger">{errorText(save.error)}</p>}
        <button type="submit" className="btn btn-primary" disabled={!ready || save.isPending}>
          {save.isPending ? "Saving…" : isNew ? "Create look" : "Save changes"}
        </button>
      </form>

      {look.data && !piecesChanged && (
        <>
          <PhotoSection look={look.data} pieces={pieces} />
          <PublishSection look={look.data} />
        </>
      )}
    </div>
  );
}

function Field({ id, label, value, onChange, rtl, area, required }: {
  id: string; label: string; value: string; onChange: (v: string) => void; rtl?: boolean; area?: boolean; required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">{label}</label>
      {area ? (
        <textarea id={id} maxLength={600} className="field h-20 py-2" dir={rtl ? "rtl" : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} maxLength={120} className="field" dir={rtl ? "rtl" : undefined} required={required} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function PieceList({ pieces, setPieces }: { pieces: Piece[]; setPieces: (fn: (list: Piece[]) => Piece[]) => void }) {
  const update = (index: number, patch: Partial<Piece>) => setPieces((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const move = (from: number, to: number) =>
    setPieces((list) => {
      if (to < 0 || to >= list.length) return list;
      const copy = [...list];
      const [piece] = copy.splice(from, 1);
      copy.splice(to, 0, piece!);
      return copy;
    });
  if (pieces.length === 0) return <p className="mt-4 text-sm text-stone">No pieces yet. Search for a product below.</p>;
  return (
    <ol className="mt-4 space-y-3">
      {pieces.map((piece, index) => {
        const colour = piece.colours.find((c) => c.id === piece.colorId);
        return (
          <li key={piece.productId} className="grid gap-3 border border-line bg-card p-3 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center">
            {colour?.imageUrl ? (
              <img src={colour.imageUrl} alt="" className="h-24 w-[72px] border border-line object-cover" />
            ) : (
              <div className="grid h-24 w-[72px] place-items-center border border-danger text-center text-[10px] text-danger">No photo</div>
            )}
            <div className="min-w-0 space-y-2">
              <p className="font-semibold">
                {piece.productName}
                {piece.productStatus !== "ACTIVE" && <span className="ms-2 text-xs font-normal text-danger">Not on sale: hidden from customers</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                <label className="sr-only" htmlFor={`colour-${piece.productId}`}>Colour in the photo</label>
                <select id={`colour-${piece.productId}`} className="field h-9 w-44" value={piece.colorId} onChange={(e) => update(index, { colorId: Number(e.target.value) })}>
                  {piece.colours.map((c) => (
                    <option key={c.id} value={c.id}>{c.nameEn}{c.imageUrl ? "" : " (no photo)"}</option>
                  ))}
                </select>
                <label className="sr-only" htmlFor={`role-${piece.productId}`}>Kind of piece</label>
                <select id={`role-${piece.productId}`} className="field h-9 w-72" value={piece.role} onChange={(e) => update(index, { role: e.target.value as LookRole })}>
                  {Object.entries(ROLE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 text-xs">
              <button type="button" className="cursor-pointer underline disabled:opacity-40" disabled={index === 0} onClick={() => move(index, index - 1)}>Up</button>
              <button type="button" className="cursor-pointer underline disabled:opacity-40" disabled={index === pieces.length - 1} onClick={() => move(index, index + 1)}>Down</button>
              <button type="button" className="cursor-pointer text-danger underline" onClick={() => setPieces((list) => list.filter((_, i) => i !== index))}>Remove</button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ProductPicker({ exclude, onPick }: { exclude: number[]; onPick: (piece: Piece) => void }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState("");
  const results = useQuery({
    queryKey: ["admin", "look-picker", q],
    queryFn: () => api<Page<AdminProduct>>("GET", `/api/v1/admin/products?pageSize=8&q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
  const pick = async (id: number) => {
    setAdding(id);
    setError("");
    try {
      onPick(await loadProduct(id));
      setQ("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAdding(null);
    }
  };
  return (
    <div className="mt-4 border border-dashed border-line p-3">
      <label htmlFor="picker" className="mb-1 block text-xs font-medium">Add a product</label>
      <input id="picker" className="field" placeholder="Type at least 2 letters of the product name" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {results.data && (
        <ul className="mt-2 divide-y divide-line">
          {results.data.items.length === 0 && <li className="py-2 text-sm text-stone">No product matches.</li>}
          {results.data.items.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {p.nameEn} <span className="text-xs text-stone">· {p.status === "ACTIVE" ? "on sale" : p.status.toLowerCase()}</span>
              </span>
              <button type="button" className="btn btn-outline h-9" disabled={exclude.includes(p.id) || adding !== null} onClick={() => void pick(p.id)}>
                {exclude.includes(p.id) ? "Added" : adding === p.id ? "Adding…" : "Add"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The photo: AI candidates made from the product photos, compared side by side with them and
 * approved by a person, or a photoshoot photo uploaded directly.
 */
function PhotoSection({ look, pieces }: { look: AdminLook; pieces: Piece[] }) {
  const client = useQueryClient();
  const ai = useQuery({ queryKey: ["admin", "looks", "ai"], queryFn: () => api<AiStatus>("GET", "/api/v1/admin/looks/ai") });
  const latest = useQuery({
    queryKey: ["admin", "look", look.id, "generation"],
    // 204 (never generated) comes back as undefined, which a query may not hold.
    queryFn: () => api<LookGeneration | undefined>("GET", `/api/v1/admin/looks/${look.id}/generations/latest`).then((g) => g ?? null),
    refetchInterval: (query) => (query.state.data?.status === "RUNNING" ? 3000 : false),
  });
  const [chosen, setChosen] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");

  const generate = useMutation({
    mutationFn: () => api<LookGeneration>("POST", `/api/v1/admin/looks/${look.id}/generations`),
    onSuccess: (generation) => {
      setChosen(null);
      setChecked(false);
      setMessage("");
      client.setQueryData(["admin", "look", look.id, "generation"], generation);
    },
  });

  const setPhoto = async (file: File, source: "AI" | "PHOTO") => {
    const [uploaded] = await uploadImages([file]);
    if (!uploaded) throw new ApiError(500, "IMAGE_UPLOAD_FAILED", "Could not upload the photo.");
    await api<void>("PUT", `/api/v1/admin/looks/${look.id}/image`, { ...uploaded, source });
    if (look.imagePublicId) void deleteUploadedImage(look.imagePublicId).catch(() => undefined);
    await client.invalidateQueries({ queryKey: ["admin", "look", look.id] });
    await client.invalidateQueries({ queryKey: ["admin", "looks"] });
  };

  const approve = useMutation({
    mutationFn: async () => {
      const generation = latest.data!;
      const response = await fetch(`/api/v1/admin/looks/${look.id}/generations/${generation.id}/images/${chosen}`, { credentials: "same-origin" });
      if (!response.ok) throw new ApiError(response.status, "IMAGE", "Could not read the chosen photo. Try again.");
      const blob = await response.blob();
      const extension = blob.type === "image/png" ? "png" : "jpg";
      await setPhoto(new File([blob], `look-${look.slug}.${extension}`, { type: blob.type }), "AI");
    },
    onSuccess: () => setMessage("Photo approved. Publish the look when you are ready."),
  });

  const upload = useMutation({
    mutationFn: (file: File) => setPhoto(file, "PHOTO"),
    onSuccess: () => setMessage("Photo saved."),
  });

  const generation = latest.data;
  const worn = pieces.filter((p) => p.role !== "ACCESSORY");
  const missingPhoto = worn.filter((p) => !p.colours.find((c) => c.id === p.colorId)?.imageUrl);

  return (
    <section className="mt-12 border-t border-line pt-8" aria-labelledby="photo-title">
      <h2 id="photo-title" className="text-lg font-semibold">Model photo</h2>
      <div className="mt-4 grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          {look.imageUrl ? (
            <img src={look.imageUrl} alt="Current look photo" className="aspect-[2/3] w-full border border-line bg-studio object-cover" />
          ) : (
            <div className="grid aspect-[2/3] w-full place-items-center border border-dashed border-line bg-studio text-xs text-stone">No photo yet</div>
          )}
          <p className="mt-2 text-xs text-stone">
            {look.imageSource === "AI" ? "AI photo, approved by staff. Customers see a small note saying so." : look.imageSource === "PHOTO" ? "Photoshoot photo." : ""}
          </p>
          <label className={`btn btn-outline mt-3 w-full ${upload.isPending ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
            {upload.isPending ? "Uploading…" : "Upload a photoshoot photo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.currentTarget.value = "";
              }}
            />
          </label>
          {upload.isError && <p role="alert" className="mt-2 text-xs text-danger">{errorText(upload.error)}</p>}
        </div>

        <div>
          <h3 className="font-semibold">Make the photo with AI</h3>
          {ai.data && !ai.data.available && (
            <p className="mt-2 text-sm text-stone">AI photos are not set up yet. Add the FASHN API key to the server (FASHN_API_KEY) to switch them on.</p>
          )}
          {ai.data?.provider === "LOCAL_PREVIEW" && (
            <p className="mt-2 border border-line bg-bone p-2 text-xs">
              Local test mode: no AI key on this machine, so you get labelled test boards made from the product photos, not model photos.
            </p>
          )}
          {ai.data?.available && (
            <>
              <p className="mt-2 text-sm text-stone">
                Makes {ai.data.candidates} options of a male model wearing exactly these pieces, from their product photos. It takes
                about a minute. Each run is billed by the AI service.
              </p>
              {missingPhoto.length > 0 && (
                <p className="mt-2 text-sm text-danger">
                  Add a product photo first for: {missingPhoto.map((p) => p.productName).join(", ")}.
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary mt-4"
                disabled={generate.isPending || generation?.status === "RUNNING" || worn.length === 0 || missingPhoto.length > 0}
                onClick={() => generate.mutate()}
              >
                {generation?.status === "RUNNING" ? "Making photos…" : generation ? "Make new options" : "Make photos with AI"}
              </button>
              {generate.isError && <p role="alert" className="mt-2 text-sm text-danger">{errorText(generate.error)}</p>}
            </>
          )}

          {generation?.status === "RUNNING" && (
            <p className="mt-4 text-sm text-stone" aria-live="polite" aria-busy="true">
              Working on it. You can stay on this page; the options appear here when they are ready.
            </p>
          )}
          {generation?.status === "FAILED" && <p role="alert" className="mt-4 text-sm text-danger">{generation.error}</p>}

          {generation?.status === "DONE" && generation.candidateCount > 0 && (
            <div className="mt-6">
              <p className="text-sm font-semibold">Compare every piece with its product photo before approving.</p>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Product photos">
                {worn.map((p) => {
                  const colour = p.colours.find((c) => c.id === p.colorId);
                  return (
                    <li key={p.productId} className="w-20 text-[11px] text-stone">
                      {colour?.imageUrl && <img src={colour.imageUrl} alt={`${p.productName}, ${colour.nameEn}`} className="aspect-[4/5] w-full border border-line object-cover" />}
                      <span className="mt-1 block truncate">{p.productName}</span>
                    </li>
                  );
                })}
              </ul>
              <fieldset className="mt-4">
                <legend className="sr-only">Choose a photo</legend>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {Array.from({ length: generation.candidateCount }, (_, n) => (
                    <label key={n} className={`block cursor-pointer border-2 ${chosen === n ? "border-ink" : "border-transparent"}`}>
                      <input type="radio" name="candidate" className="sr-only" checked={chosen === n} onChange={() => setChosen(n)} />
                      <img
                        src={`/api/v1/admin/looks/${look.id}/generations/${generation.id}/images/${n}`}
                        alt={`Option ${n + 1}`}
                        className="aspect-[2/3] w-full bg-studio object-cover"
                      />
                      <span className="block py-1 text-center text-xs">Option {n + 1}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="mt-4 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                <span>I checked the colour, cut, print and logo of every piece. They match the real products.</span>
              </label>
              <button type="button" className="btn btn-primary mt-4" disabled={chosen === null || !checked || approve.isPending} onClick={() => approve.mutate()}>
                {approve.isPending ? "Saving…" : "Approve this photo"}
              </button>
              {approve.isError && <p role="alert" className="mt-2 text-sm text-danger">{errorText(approve.error)}</p>}
            </div>
          )}
          {message && <p role="status" className="mt-4 text-sm">{message}</p>}
        </div>
      </div>
    </section>
  );
}

function PublishSection({ look }: { look: AdminLook }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const status = useMutation({
    mutationFn: (next: "DRAFT" | "PUBLISHED") => api<void>("PATCH", `/api/v1/admin/looks/${look.id}/status`, { status: next }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["admin", "look", look.id] });
      await client.invalidateQueries({ queryKey: ["admin", "looks"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api<{ imagePublicId?: string }>("DELETE", `/api/v1/admin/looks/${look.id}`),
    onSuccess: async (result) => {
      if (result.imagePublicId) await deleteUploadedImage(result.imagePublicId).catch(() => undefined);
      await client.invalidateQueries({ queryKey: ["admin", "looks"] });
      navigate("/admin/looks");
    },
  });
  const published = look.status === "PUBLISHED";
  return (
    <section className="mt-12 border-t border-line pt-8" aria-labelledby="publish-title">
      <h2 id="publish-title" className="text-lg font-semibold">On the store</h2>
      <p className="mt-1 text-sm text-stone">
        {published ? (
          <>
            Live at <a href={`/looks/${look.slug}`} target="_blank" rel="noreferrer" className="underline">/looks/{look.slug}</a> and on the home page.
          </>
        ) : look.imageUrl ? (
          "Ready to publish."
        ) : (
          "Add a photo first."
        )}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {published ? (
          <button type="button" className="btn btn-outline" disabled={status.isPending} onClick={() => status.mutate("DRAFT")}>Take off the store</button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={status.isPending || !look.imageUrl} onClick={() => status.mutate("PUBLISHED")}>Publish</button>
        )}
        {!asking ? (
          <button type="button" className="cursor-pointer text-sm text-danger underline" onClick={() => setAsking(true)}>Delete look</button>
        ) : (
          <span role="group" aria-label="Delete this look?" className="flex flex-wrap items-center gap-2 border border-danger px-3 py-2 text-sm">
            <span>Delete “{look.titleEn}” and its photo? Products are not affected.</span>
            <button type="button" className="btn h-9 border-danger bg-danger text-bone" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? "Deleting…" : "Yes, delete"}
            </button>
            <button type="button" className="cursor-pointer underline" onClick={() => setAsking(false)}>Keep it</button>
          </span>
        )}
      </div>
      {status.isError && <p role="alert" className="mt-2 text-sm text-danger">{errorText(status.error)}</p>}
      {remove.isError && <p role="alert" className="mt-2 text-sm text-danger">{errorText(remove.error)}</p>}
    </section>
  );
}
