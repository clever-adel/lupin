import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { errorText, money, type AdminProduct } from "~/features/admin/shared";
import { StockCell } from "~/features/admin/stock-cell";
import { api, deleteUploadedImage, imagesWithoutSizes, saveImageSizes, uploadImages } from "~/lib/http";
import { photoUrl } from "~/lib/photo-sizes";
import type { Department, Page } from "~/lib/types";

const PRODUCT_STATUS: Record<string, string> = { DRAFT: "Draft (hidden)", ACTIVE: "On sale", ARCHIVED: "Archived (hidden)" };

/**
 * Deleting asks once more, naming the product, because it cannot be undone from the dashboard.
 * Orders that already contain the product keep it; customers can no longer see or buy it.
 */
function DeleteProduct({ id, name, onDone }: { id: number; name: string; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: () => api<void>("DELETE", `/api/v1/admin/products/${id}`),
    onSuccess: onDone,
  });
  if (!asking) {
    return (
      <button type="button" className="cursor-pointer px-2 text-sm text-danger underline" onClick={() => setAsking(true)}>
        Delete
      </button>
    );
  }
  return (
    <span role="group" aria-label={`Delete ${name}?`} className="flex flex-wrap items-center gap-2 border border-danger px-3 py-2 text-sm">
      <span>Delete “{name}” for good? Past orders keep it.</span>
      <button
        type="button"
        className="btn h-9 border-danger bg-danger text-bone"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        {remove.isPending ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" className="cursor-pointer underline" onClick={() => setAsking(false)}>
        Keep it
      </button>
      {remove.isError && <span role="alert" className="basis-full text-danger">{errorText(remove.error)}</span>}
    </span>
  );
}

function CategoryRow({ department, category }: { department: string; category: Department["categories"][number] }) {
  const client = useQueryClient();
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [nameEn, setNameEn] = useState(category.nameEn);
  const [nameAr, setNameAr] = useState(category.nameAr);
  const path = `/api/v1/admin/departments/${department}/categories/${category.slug}`;
  const done = () => {
    setMode("view");
    client.invalidateQueries({ queryKey: ["admin", "departments"] });
  };
  const rename = useMutation({ mutationFn: () => api<void>("PUT", path, { nameEn, nameAr }), onSuccess: done });
  const remove = useMutation({ mutationFn: () => api<void>("DELETE", path), onSuccess: done });
  const failure = rename.error ?? remove.error;

  return (
    <li className="border-t border-line py-2 text-sm">
      {mode === "edit" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename.mutate();
          }}
        >
          <label className="text-xs">
            English
            <input className="field mt-1 h-9 w-44" maxLength={80} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </label>
          <label className="text-xs">
            Arabic
            <input className="field mt-1 h-9 w-44" dir="rtl" maxLength={80} value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary h-9" disabled={rename.isPending || !nameEn.trim() || !nameAr.trim()}>
            Save
          </button>
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={() => {
              setNameEn(category.nameEn);
              setNameAr(category.nameAr);
              setMode("view");
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="me-auto">
            {category.parentSlug && <span className="text-stone">↳ </span>}
            <span className="font-medium">{category.nameEn}</span> <span className="text-stone" dir="rtl">{category.nameAr}</span>
          </span>
          {mode === "delete" ? (
            <span role="group" aria-label={`Delete ${category.nameEn}?`} className="flex flex-wrap items-center gap-2">
              <span>Delete “{category.nameEn}”?</span>
              <button type="button" className="btn h-9 border-danger bg-danger text-bone" disabled={remove.isPending} onClick={() => remove.mutate()}>
                Yes, delete
              </button>
              <button type="button" className="cursor-pointer underline" onClick={() => setMode("view")}>Keep it</button>
            </span>
          ) : (
            <>
              <button type="button" className="cursor-pointer underline" onClick={() => setMode("edit")}>
                Edit <span className="sr-only">{category.nameEn}</span>
              </button>
              <button type="button" className="cursor-pointer text-danger underline" onClick={() => setMode("delete")}>
                Delete <span className="sr-only">{category.nameEn}</span>
              </button>
            </>
          )}
        </div>
      )}
      {failure && <p role="alert" className="mt-1 text-danger">{errorText(failure)}</p>}
    </li>
  );
}

/** Rename or delete categories. A category can only be deleted once no product is left in it. */
function Categories() {
  const departments = useQuery({
    queryKey: ["admin", "departments"],
    queryFn: () => api<AdminDepartment[]>("GET", "/api/v1/admin/departments"),
  });
  if (!departments.data) return null;
  return (
    <section className="mt-6 border border-line bg-card p-4" aria-labelledby="categories-title">
      <h2 id="categories-title" className="text-sm font-semibold">Categories</h2>
      <p className="mt-1 text-xs text-stone">
        Renaming keeps the category’s link the same. A category can be deleted once no product is in it: move its
        products to another category (open the product and change “Category”) or delete them first. New categories are
        added from a product’s page.
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        {departments.data.map((d) => (
          <div key={d.slug}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone">{d.nameEn}</h3>
            {d.categories.length === 0 ? (
              <p className="mt-2 text-sm text-stone">No categories.</p>
            ) : (
              <ul className="mt-1">
                {d.categories.map((c) => (
                  <CategoryRow key={c.slug} department={d.slug} category={c} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const DEPARTMENT_STATE: Record<AdminDepartment["status"], string> = {
  ACTIVE: "Open",
  COMING_SOON: "Coming soon",
  HIDDEN: "Hidden from the store",
};

type AdminDepartment = Omit<Department, "status"> & {
  status: "ACTIVE" | "COMING_SOON" | "HIDDEN";
  /** The photo the owner uploaded for the home page card; none means the first piece's photo is used. */
  ownImageUrl?: string;
  ownImagePublicId?: string;
};

/**
 * The department's card on the home page: a wide photo the owner uploads, or, without one, the main photo
 * of the department's first piece in the display order.
 */
function DepartmentPhoto({ department }: { department: AdminDepartment }) {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const own = department.ownImageUrl ?? "";
  const shown = own || department.imageUrl || "";
  const replace = useMutation({
    mutationFn: async (file: File | null) => {
      let next = { imageUrl: "", imagePublicId: "" };
      if (file) {
        const [uploaded] = await uploadImages([file]);
        if (!uploaded) throw new Error("Could not upload the photo.");
        next = { imageUrl: uploaded.url, imagePublicId: uploaded.publicId };
      }
      let previous: { imagePublicId?: string };
      try {
        previous = await api<{ imagePublicId?: string }>("PUT", `/api/v1/admin/departments/${department.slug}/photo`, next);
      } catch (e) {
        if (next.imagePublicId) await deleteUploadedImage(next.imagePublicId).catch(() => undefined);
        throw e;
      }
      // The old file is no longer used anywhere; a failed clean-up only leaves an unused file behind.
      if (previous.imagePublicId) await deleteUploadedImage(previous.imagePublicId).catch(() => undefined);
    },
    onMutate: () => setError(""),
    onError: (e) => setError(e instanceof Error ? e.message : errorText(e)),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin", "departments"] }),
  });
  return (
    <div className="flex w-full flex-wrap items-center gap-3 border-t border-line pt-2">
      <span className="grid aspect-[3/2] w-24 place-items-center overflow-hidden bg-studio text-center text-[10px] text-stone">
        {shown ? <img src={photoUrl(shown, 320)} alt={`${department.nameEn} card photo`} className="h-full w-full object-cover" /> : "No photo"}
      </span>
      <span className="text-xs text-stone">
        {own ? "Home page card: your photo." : "Home page card: the first piece's photo. Upload a wide photo (3 by 2) to use your own."}
      </span>
      <label className={`btn btn-outline h-9 ${replace.isPending ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
        {replace.isPending ? "Saving…" : own ? `Change ${department.nameEn} photo` : `Upload ${department.nameEn} photo`}
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
      {own && (
        <button type="button" className="cursor-pointer text-sm underline" disabled={replace.isPending} onClick={() => replace.mutate(null)}>
          Use the first piece&apos;s photo
        </button>
      )}
      {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    </div>
  );
}

/**
 * Each department is open, coming soon (name shown with a "Soon" tag, products hidden) or hidden
 * (not shown anywhere in the store: menu, home page or shop). Hidden ones stay listed here to show again.
 */
function Departments() {
  const client = useQueryClient();
  const departments = useQuery({
    queryKey: ["admin", "departments"],
    queryFn: () => api<AdminDepartment[]>("GET", "/api/v1/admin/departments"),
  });
  const setStatus = useMutation({
    mutationFn: ({ slug, status }: { slug: string; status: string }) =>
      api<void>("PATCH", `/api/v1/admin/departments/${slug}`, { status }),
    onSettled: () => client.invalidateQueries({ queryKey: ["admin", "departments"] }),
  });
  if (!departments.data) return null;
  return (
    <section className="mt-6 border border-line bg-card p-4" aria-labelledby="departments-title">
      <h2 id="departments-title" className="text-sm font-semibold">Departments</h2>
      <p className="mt-1 text-xs text-stone">
        Customers can only shop a department that is open. “Coming soon” shows its name with a “Soon” tag and hides its
        products. “Hide” removes it from the store completely: the menu, the home page and the shop.
      </p>
      {setStatus.isError && <p role="alert" className="mt-2 text-sm text-danger">{errorText(setStatus.error)}</p>}
      <ul className="mt-3 flex flex-wrap gap-3">
        {departments.data.map((d) => {
          const hidden = d.status === "HIDDEN";
          const choices = (["ACTIVE", "COMING_SOON", "HIDDEN"] as const).filter((s) => s !== d.status);
          const label = {
            ACTIVE: `Open ${d.nameEn}`,
            COMING_SOON: hidden ? `Show ${d.nameEn} as coming soon` : `Close ${d.nameEn}`,
            HIDDEN: `Hide ${d.nameEn}`,
          };
          return (
            <li
              key={d.slug}
              className={`flex flex-wrap items-center gap-3 border px-3 py-2 text-sm ${hidden ? "border-dashed border-stone/60 text-stone" : "border-line"}`}
            >
              <span className="me-auto">
                <span className="font-semibold">{d.nameEn}</span>
                <span className="block text-xs text-stone">
                  {DEPARTMENT_STATE[d.status]}
                  {d.status === "ACTIVE" && ` · ${d.productCount} on sale`}
                </span>
              </span>
              {choices.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={s === "ACTIVE" ? "btn btn-primary" : "btn btn-outline"}
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ slug: d.slug, status: s })}
                >
                  {label[s]}
                </button>
              ))}
              {!hidden && <DepartmentPhoto department={d} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Photos uploaded before the store made phone-size copies are sent full size to every phone. This makes
 * their copies in this browser, one photo at a time. Shown only while such photos exist.
 */
function PhotoSizes() {
  const pending = useQuery({ queryKey: ["admin", "media-without-sizes"], queryFn: imagesWithoutSizes });
  const [progress, setProgress] = useState<{ done: number; failed: number; total: number } | null>(null);
  const keys = pending.data ?? [];
  if (!keys.length && !progress) return null;
  const running = progress !== null && progress.done + progress.failed < progress.total;
  const prepare = async () => {
    const total = keys.length;
    let done = 0;
    let failed = 0;
    setProgress({ done, failed, total });
    for (const key of keys) {
      const ok = await fetch(`/media/${encodeURIComponent(key)}`)
        .then((response) => (response.ok ? response.blob() : Promise.reject(new Error())))
        .then((photo) => saveImageSizes(key, photo))
        .catch(() => false);
      if (ok) done += 1;
      else failed += 1;
      setProgress({ done, failed, total });
    }
    await pending.refetch();
  };
  return (
    <section aria-labelledby="photo-sizes" className="mt-5 border border-line bg-card p-4">
      <h2 id="photo-sizes" className="font-semibold">Phone-size photos</h2>
      {progress && !running ? (
        <p className="mt-1 text-sm" role="status">
          Prepared {progress.done} of {progress.total} photos.
          {progress.failed > 0 && " Some could not be prepared in this browser; try again in Chrome or Edge."}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-stone">
            {keys.length} {keys.length === 1 ? "photo was" : "photos were"} uploaded before smaller copies were made, so
            phones download them full size. Preparing them takes a few seconds per photo; keep this page open.
          </p>
          <button type="button" className="btn btn-outline mt-3" disabled={running} onClick={() => void prepare()}>
            {running ? `Preparing ${progress.done + progress.failed + 1} of ${progress.total}…` : "Prepare phone-size photos"}
          </button>
        </>
      )}
    </section>
  );
}

export default function AdminProducts() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const page = Number(params.get("page")) || 0;
  const key = ["admin", "products", q, page];

  const products = useQuery({
    queryKey: key,
    queryFn: () => api<Page<AdminProduct>>("GET", `/api/v1/admin/products?page=${page}&q=${encodeURIComponent(q)}`),
    placeholderData: keepPreviousData,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["admin"] });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api<void>("PATCH", `/api/v1/admin/products/${id}/status`, { status }),
    onSettled: refresh,
  });

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="display text-2xl">Products &amp; stock</h1>
        <Link to="/admin/products/new" className="btn btn-primary">New product</Link>
      </div>
      <p className="mt-2 text-sm text-stone">
        “Reserved” is stock held for orders that have not shipped yet. “Can sell” is what customers can still buy.
      </p>

      <PhotoSizes />
      <Departments />
      <Categories />

      <form
        className="mt-5 flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const value = String(new FormData(e.currentTarget).get("q") ?? "").trim();
          setParams(value ? { q: value } : {});
        }}
      >
        <div>
          <label htmlFor="q" className="mb-1.5 block text-sm font-medium">Product name</label>
          <input id="q" name="q" defaultValue={q} key={q} className="field w-64" />
        </div>
        <button type="submit" className="btn btn-primary">Search</button>
      </form>
      {setStatus.isError && <p role="alert" className="mt-4 text-sm text-danger">{errorText(setStatus.error)}</p>}

      <ul className="mt-6 space-y-4" aria-busy={products.isFetching}>
        {products.data?.items.map((p) => (
          <li key={p.id} className="border border-line bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  <Link to={`/admin/products/${p.id}`} className="underline">{p.nameEn}</Link>
                </h2>
                <p className="text-sm text-stone">
                  {p.salePrice ? `${money(p.salePrice)} (was ${money(p.price)})` : money(p.price)} · {PRODUCT_STATUS[p.status]}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: p.id, status: p.status === "ACTIVE" ? "DRAFT" : "ACTIVE" })}
                >
                  {p.status === "ACTIVE" ? "Take off sale" : "Put on sale"}
                </button>
                <DeleteProduct id={p.id} name={p.nameEn} onDone={refresh} />
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="text-xs text-stone">
                  <tr>
                    <th scope="col" className="py-1 pe-3 text-start font-medium">Colour · size</th>
                    <th scope="col" className="px-3 py-1 text-start font-medium">In warehouse</th>
                    <th scope="col" className="px-3 py-1 text-start font-medium">Reserved</th>
                    <th scope="col" className="px-3 py-1 text-start font-medium">Can sell</th>
                    <th scope="col" className="py-1 ps-3 text-start font-medium">Add / remove pieces</th>
                  </tr>
                </thead>
                <tbody>
                  {p.variants.map((v) => <StockCell key={v.variantId} variant={v} onDone={refresh} />)}
                </tbody>
              </table>
            </div>
          </li>
        ))}
      </ul>
      {products.isPending && <p className="mt-6 text-sm text-stone">Loading…</p>}
      {products.isError && <p className="mt-6 text-sm text-danger" role="alert">Could not load products.</p>}
      {products.data?.items.length === 0 && <p className="mt-6 text-sm text-stone">No products match.</p>}

      {products.data && products.data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button type="button" className="btn btn-outline" disabled={page === 0} onClick={() => setParams({ ...(q && { q }), page: String(page - 1) })}>Previous</button>
          <span>Page {page + 1} of {products.data.totalPages}</span>
          <button type="button" className="btn btn-outline" disabled={page + 1 >= products.data.totalPages} onClick={() => setParams({ ...(q && { q }), page: String(page + 1) })}>Next</button>
        </div>
      )}
    </div>
  );
}
