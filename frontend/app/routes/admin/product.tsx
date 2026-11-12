import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { errorText } from "~/features/admin/shared";
import { api, deleteUploadedImage, uploadImages } from "~/lib/http";
import type { Department } from "~/lib/types";

interface Detail {
  id: number;
  slug: string;
  status: string;
  departmentSlug: string;
  categorySlug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  fabricEn: string;
  fabricAr: string;
  fitEn: string;
  fitAr: string;
  badge?: string;
  price: number;
  salePrice?: number;
  featured: boolean;
  colors: Colour[];
}

interface ImageInput {
  publicId: string;
  url: string;
  altEn: string;
  altAr: string;
}

interface Colour {
  id?: number;
  nameEn: string;
  nameAr: string;
  hex: string;
  images: ImageInput[];
}

const ADULT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "ONE"];
const KIDS_SIZES = ["2-3Y", "4-5Y", "6-7Y", "8-9Y", "10-11Y", "12-13Y"];
const EMPTY: Omit<Detail, "id" | "slug" | "status" | "colors"> = {
  departmentSlug: "", categorySlug: "", nameEn: "", nameAr: "", descriptionEn: "", descriptionAr: "",
  fabricEn: "", fabricAr: "", fitEn: "", fitAr: "", badge: "", price: 0, featured: false,
};

function Text({ id, label, value, onChange, rtl, area, required }: {
  id: string; label: string; value: string; onChange: (v: string) => void; rtl?: boolean; area?: boolean; required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">{label}</label>
      {area ? (
        <textarea id={id} className="field h-24 py-2" dir={rtl ? "rtl" : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className="field" dir={rtl ? "rtl" : undefined} required={required} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function ColourPhotos({ colour, onChange }: { colour: Colour; onChange: (images: ImageInput[]) => void }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const move = (from: number, to: number) => {
    if (to < 0 || to >= colour.images.length || from === to) return;
    const images = [...colour.images];
    const image = images.splice(from, 1)[0];
    if (!image) return;
    images.splice(to, 0, image);
    onChange(images);
  };
  const update = (index: number, patch: Partial<ImageInput>) =>
    onChange(colour.images.map((image, i) => i === index ? { ...image, ...patch } : image));
  const addFiles = async (selected: FileList | null) => {
    if (!selected?.length) return;
    const files = Array.from(selected);
    if (colour.images.length + files.length > 10) {
      setUploadError("Choose up to 10 photos for this colour.");
      return;
    }
    setUploadError("");
    setUploading(true);
    try {
      const uploaded = await uploadImages(files);
      onChange([...colour.images, ...uploaded.map((image) => ({ ...image, altEn: "", altAr: "" }))]);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not upload the selected images.");
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{colour.nameEn || "Colour"} photos ({colour.images.filter((image) => image.url.trim()).length}/10)</h3>
        <label className={`btn btn-outline ${colour.images.length >= 10 || uploading ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
          {uploading ? "Uploading…" : "Choose photos"}
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            disabled={colour.images.length >= 10 || uploading}
            onChange={(event) => {
              void addFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      <p className="mt-2 text-sm text-stone">Upload order is kept. The first photo is the main photo for this colour. Choose up to 10 JPG, PNG, WebP, or AVIF photos (10 MB each, 50 MB per upload).</p>
      {uploadError && <p className="mt-2 text-sm text-danger" role="alert">{uploadError}</p>}
      {colour.images.length === 0 ? (
        <p className="mt-2 text-sm text-stone">No photos added yet.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {colour.images.map((image, index) => (
            <li key={image.publicId} className="grid items-center gap-2 sm:grid-cols-[100px_minmax(0,1fr)_1fr_1fr_auto]">
              <img src={image.url} alt="" className="h-24 w-24 rounded border border-line object-cover" />
              <div className="flex flex-col items-start gap-1">
                <span className="text-xs text-stone">Photo {index + 1}</span>
                {index === 0 ? (
                  <span className="text-xs font-semibold">Main photo</span>
                ) : (
                  <button type="button" className="cursor-pointer text-xs underline" onClick={() => move(index, 0)}>
                    Make main photo
                  </button>
                )}
                <div className="flex gap-2">
                  <button type="button" aria-label={`Move photo ${index + 1} up`} className="cursor-pointer text-xs underline disabled:opacity-40" disabled={index === 0} onClick={() => move(index, index - 1)}>
                    Move up
                  </button>
                  <button type="button" aria-label={`Move photo ${index + 1} down`} className="cursor-pointer text-xs underline disabled:opacity-40" disabled={index === colour.images.length - 1} onClick={() => move(index, index + 1)}>
                    Move down
                  </button>
                </div>
              </div>
              <input className="field" aria-label={`Photo ${index + 1} alt text (English)`} placeholder="Alt text (English)" value={image.altEn} onChange={(event) => update(index, { altEn: event.target.value })} />
              <input className="field" aria-label={`Photo ${index + 1} alt text (Arabic)`} dir="rtl" placeholder="النص البديل (عربي)" value={image.altAr} onChange={(event) => update(index, { altAr: event.target.value })} />
              <button type="button" className="cursor-pointer px-2 text-sm underline" onClick={() => onChange(colour.images.filter((_, i) => i !== index))}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Loads the product (when editing) before the form mounts, so the form's state starts from real values. */
export default function AdminProduct() {
  const id = useParams().id ?? "new";
  const isNew = id === "new";
  const detail = useQuery({
    queryKey: ["admin", "product", id],
    queryFn: () => api<Detail>("GET", `/api/v1/admin/products/${encodeURIComponent(id)}`),
    enabled: !isNew,
    retry: false,
  });
  const departments = useQuery({
    queryKey: ["admin", "departments"],
    queryFn: () => api<Department[]>("GET", "/api/v1/catalog/departments"),
  });

  if (detail.isError || departments.isError) return <p className="text-danger" role="alert">Could not load the product.</p>;
  if ((!isNew && !detail.data) || !departments.data) return <p className="text-stone" aria-busy="true">Loading…</p>;
  return <ProductForm key={id} existing={detail.data ?? null} departments={departments.data} />;
}

function ProductForm({ existing, departments }: { existing: Detail | null; departments: Department[] }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState({ ...EMPTY, ...(existing ?? { departmentSlug: departments[0]?.slug ?? "" }) });
  const [price, setPrice] = useState(existing ? String(existing.price) : "");
  const [salePrice, setSalePrice] = useState(existing?.salePrice ? String(existing.salePrice) : "");
  const [sizeGroup, setSizeGroup] = useState<"ADULT" | "KIDS">("ADULT");
  const [sizes, setSizes] = useState<string[]>([]);
  const [colours, setColours] = useState<Colour[]>(() => existing?.colors ?? [{ nameEn: "", nameAr: "", hex: "#0B0B0C", images: [] }]);
  const [mainColour, setMainColour] = useState(0);
  const [stock, setStock] = useState("0");
  const [newCategoryEn, setNewCategoryEn] = useState("");
  const [newCategoryAr, setNewCategoryAr] = useState("");
  const set = (field: keyof typeof EMPTY) => (value: string) => setF((prev) => ({ ...prev, [field]: value }));

  const department = departments.find((d) => d.slug === f.departmentSlug);
  const categories = department?.categories ?? [];

  const addCategory = useMutation({
    mutationFn: () =>
      api<{ slug: string }>("POST", "/api/v1/admin/categories", {
        departmentSlug: f.departmentSlug, parentSlug: null, nameEn: newCategoryEn, nameAr: newCategoryAr,
      }),
    onSuccess: async ({ slug }) => {
      await client.invalidateQueries({ queryKey: ["admin", "departments"] });
      setF((prev) => ({ ...prev, categorySlug: slug }));
      setNewCategoryEn("");
      setNewCategoryAr("");
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const common = {
        nameEn: f.nameEn, nameAr: f.nameAr, categorySlug: f.categorySlug,
        descriptionEn: f.descriptionEn, descriptionAr: f.descriptionAr, fabricEn: f.fabricEn, fabricAr: f.fabricAr,
        fitEn: f.fitEn, fitAr: f.fitAr, badge: f.badge || null,
        price: Number(price), salePrice: salePrice.trim() === "" ? null : Number(salePrice),
      };
      if (existing) {
        await api("PUT", `/api/v1/admin/products/${existing.id}`, { ...common, featured: f.featured });
        const removed = (existing.colors ?? []).flatMap((colour) => colour.images)
          .filter((image) => image.url.startsWith("/media/") && !colours.some((colour) => colour.images.some((next) => next.publicId === image.publicId)));
        await Promise.all(colours.map((colour) =>
          api("PUT", `/api/v1/admin/products/${existing.id}/colors/${colour.id}/images`, {
            images: colour.images.filter((image) => image.url.trim()).map(({ publicId, url, altEn, altAr }) => ({ publicId, url, altEn, altAr })),
          }),
        ));
        await Promise.allSettled(removed.map((image) => deleteUploadedImage(image.publicId)));
        return existing.id;
      }
      const created = await api<{ id: number }>("POST", "/api/v1/admin/products", {
        ...common,
        departmentSlug: f.departmentSlug,
        sizeGroup,
        sizes,
        colors: colours.map((c, i) => ({ ...c, main: i === mainColour, images: c.images.filter((image) => image.url.trim()) })),
        initialStockPerVariant: Number(stock) || 0,
      });
      return created.id;
    },
    onSuccess: (productId) => {
      client.invalidateQueries({ queryKey: ["admin"] });
      if (!existing) navigate(`/admin/products/${productId}`, { replace: true });
    },
  });

  const coloursOk = colours.every((c) => c.nameEn.trim() && c.nameAr.trim());
  const missingDraftRequirements = [
    !f.nameEn.trim() ? "English product name" : "",
    !f.nameAr.trim() ? "Arabic product name" : "",
    !f.categorySlug ? (categories.length ? "category" : "create a category first") : "",
    !(Number(price) > 0) ? "price greater than zero" : "",
    sizes.length === 0 ? "at least one size" : "",
    ...colours.flatMap((colour, index) => [
      !colour.nameEn.trim() ? `colour ${index + 1} English name` : "",
      !colour.nameAr.trim() ? `colour ${index + 1} Arabic name` : "",
    ]),
  ].filter(Boolean);
  const ready = f.nameEn.trim() && f.nameAr.trim() && f.categorySlug && Number(price) > 0
    && (existing || (sizes.length > 0 && coloursOk));
  const box = "border border-line bg-card p-5";

  return (
    <form
      className="max-w-4xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Link to="/admin/products" className="text-sm underline">← Products &amp; stock</Link>
      <h1 className="display text-2xl">{existing ? existing.nameEn : "New product"}</h1>
      {existing ? (
        <p className="text-sm text-stone">
          Changes apply to what is sold from now on. Orders already placed keep the name and price they were bought at.
        </p>
      ) : (
        <p className="text-sm text-stone">
          The product is saved as a hidden draft. Put it on sale from “Products &amp; stock” when it is ready.
          Upload up to 10 photos from your device for each colour below.
        </p>
      )}

      <section className={box}>
        <h2 className="font-semibold">Name and category</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Text id="nameEn" label="Name (English)" value={f.nameEn} onChange={set("nameEn")} required />
          <Text id="nameAr" label="Name (Arabic)" value={f.nameAr} onChange={set("nameAr")} rtl required />
          <div>
            <label htmlFor="department" className="mb-1 block text-xs font-medium">Department</label>
            <select
              id="department"
              className="field"
              disabled={Boolean(existing)}
              value={f.departmentSlug}
              onChange={(e) => setF((prev) => ({ ...prev, departmentSlug: e.target.value, categorySlug: "" }))}
            >
              {departments.map((d) => <option key={d.slug} value={d.slug}>{d.nameEn}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="category" className="mb-1 block text-xs font-medium">Category</label>
            <select id="category" className="field" value={f.categorySlug} onChange={(e) => set("categorySlug")(e.target.value)}>
              <option value="">Choose a category</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.nameEn}</option>)}
            </select>
          </div>
        </div>
        {!categories.length && !existing && (
          <p className="mt-3 text-sm text-danger" role="status">There are no categories in this department yet. Create one below before saving the draft.</p>
        )}
        <details className="mt-3 text-sm" open={!categories.length && !existing}>
          <summary className="cursor-pointer">Add a new category to {department?.nameEn ?? "this department"}</summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Text id="catEn" label="Category name (English)" value={newCategoryEn} onChange={setNewCategoryEn} />
            <Text id="catAr" label="Category name (Arabic)" value={newCategoryAr} onChange={setNewCategoryAr} rtl />
            <button
              type="button"
              className="btn btn-outline"
              disabled={!newCategoryEn.trim() || !newCategoryAr.trim() || addCategory.isPending}
              onClick={() => addCategory.mutate()}
            >
              Add category
            </button>
          </div>
          {addCategory.isError && <p role="alert" className="mt-2 text-danger">{errorText(addCategory.error)}</p>}
        </details>
      </section>

      <section className={box}>
        <h2 className="font-semibold">Price</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Text id="price" label="Price (EGP)" value={price} onChange={setPrice} required />
          <Text id="salePrice" label="Discount price (EGP, empty = none)" value={salePrice} onChange={setSalePrice} />
          <div>
            <label htmlFor="badge" className="mb-1 block text-xs font-medium">Label on the photo</label>
            <select id="badge" className="field" value={f.badge ?? ""} onChange={(e) => set("badge")(e.target.value)}>
              <option value="">None</option>
              <option value="NEW">New</option>
              <option value="BESTSELLER">Bestseller</option>
            </select>
          </div>
        </div>
        {existing && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-ink" checked={f.featured} onChange={(e) => setF((prev) => ({ ...prev, featured: e.target.checked }))} />
            Show first on the home page
          </label>
        )}
      </section>

      <section className={box}>
        <h2 className="font-semibold">Description</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Text id="descEn" label="Description (English)" value={f.descriptionEn} onChange={set("descriptionEn")} area />
          <Text id="descAr" label="Description (Arabic)" value={f.descriptionAr} onChange={set("descriptionAr")} rtl area />
          <Text id="fabricEn" label="Fabric (English)" value={f.fabricEn} onChange={set("fabricEn")} />
          <Text id="fabricAr" label="Fabric (Arabic)" value={f.fabricAr} onChange={set("fabricAr")} rtl />
          <Text id="fitEn" label="Fit (English)" value={f.fitEn} onChange={set("fitEn")} />
          <Text id="fitAr" label="Fit (Arabic)" value={f.fitAr} onChange={set("fitAr")} rtl />
        </div>
      </section>

      {!existing && (
        <section className={box}>
          <h2 className="font-semibold">Sizes, colours and first stock</h2>
          <p className="mt-1 text-sm text-stone">These cannot be changed from the dashboard after the product is created.</p>

          <fieldset className="mt-4">
            <legend className="mb-2 text-xs font-medium">Sizes</legend>
            <div className="mb-3 flex gap-4 text-sm">
              {(["ADULT", "KIDS"] as const).map((g) => (
                <label key={g} className="flex items-center gap-2">
                  <input type="radio" name="sizeGroup" className="accent-ink" checked={sizeGroup === g} onChange={() => { setSizeGroup(g); setSizes([]); }} />
                  {g === "ADULT" ? "Adult sizes" : "Kids sizes"}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {(sizeGroup === "ADULT" ? ADULT_SIZES : KIDS_SIZES).map((s) => (
                <label key={s} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-ink"
                    checked={sizes.includes(s)}
                    onChange={() => setSizes((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]))}
                  />
                  {s === "ONE" ? "One size" : s}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="mb-2 text-xs font-medium">Colours (choose the main one shown first)</legend>
            <ul className="space-y-2">
              {colours.map((c, i) => {
                const update = (patch: Partial<Colour>) => setColours((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <input type="radio" name="mainColour" className="accent-ink" aria-label={`Main colour: ${c.nameEn || `colour ${i + 1}`}`} checked={mainColour === i} onChange={() => setMainColour(i)} />
                    <input className="field w-40" aria-label="Colour name (English)" placeholder="Black" required={!existing} value={c.nameEn} onChange={(e) => update({ nameEn: e.target.value })} />
                    <input className="field w-40" dir="rtl" aria-label="Colour name (Arabic)" placeholder="أسود" required={!existing} value={c.nameAr} onChange={(e) => update({ nameAr: e.target.value })} />
                    <input type="color" aria-label="Colour swatch" className="h-11 w-14 cursor-pointer border border-line bg-card" value={c.hex} onChange={(e) => update({ hex: e.target.value })} />
                    {colours.length > 1 && (
                      <button
                        type="button"
                        className="cursor-pointer text-sm underline"
                        onClick={() => {
                          setColours((list) => list.filter((_, j) => j !== i));
                          setMainColour((m) => (m === i ? 0 : m > i ? m - 1 : m));
                        }}
                      >
                        Remove
                      </button>
                    )}
                    <div className="basis-full ps-8">
                      <ColourPhotos colour={c} onChange={(images) => update({ images })} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <button type="button" className="btn btn-outline mt-3" disabled={colours.length >= 12} onClick={() => setColours((list) => [...list, { nameEn: "", nameAr: "", hex: "#55585C", images: [] }])}>
              Add a colour
            </button>
          </fieldset>

          <div className="mt-5 max-w-xs">
            <Text id="stock" label="Pieces in stock for each colour and size" value={stock} onChange={setStock} />
          </div>
        </section>
      )}

      {existing && (
        <section className={box}>
          <h2 className="font-semibold">Photos by colour</h2>
          <p className="mt-1 text-sm text-stone">Upload up to 10 photos per colour from your device. These appear in the product gallery when shoppers select that colour.</p>
          <div className="mt-4 divide-y divide-line">
            {colours.map((colour, index) => (
              <div key={colour.id} className={index === 0 ? "" : "pt-4"}>
                <ColourPhotos
                  colour={colour}
                  onChange={(images) => setColours((list) => list.map((item) => item.id === colour.id ? { ...item, images } : item))}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={!ready || save.isPending}>
          {save.isPending ? "Saving…" : existing ? "Save changes" : "Create draft product"}
        </button>
        {save.isSuccess && existing && <span role="status" className="text-sm">Saved.</span>}
        {save.isError && <span role="alert" className="text-sm text-danger">{errorText(save.error)}</span>}
      </div>
      {!existing && missingDraftRequirements.length > 0 && (
        <p role="status" className="text-sm text-stone">
          To enable “Create draft product”, complete: {missingDraftRequirements.join(", ")}.
        </p>
      )}
    </form>
  );
}
