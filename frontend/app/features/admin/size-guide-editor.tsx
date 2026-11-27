import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorText } from "~/features/admin/shared";
import { api } from "~/lib/http";
import { STANDARD_CHARTS, standardRows } from "~/lib/size-chart";
import type { SizeGuide, SizeGuideRow } from "~/lib/types";

const PRESETS: { labelEn: string; labelAr: string }[] = [
  { labelEn: "Chest", labelAr: "الصدر" },
  { labelEn: "Bust", labelAr: "الصدر" },
  { labelEn: "Waist", labelAr: "الوسط" },
  { labelEn: "Hips", labelAr: "الأرداف" },
  { labelEn: "Chest width (flat)", labelAr: "عرض الصدر (مفرود)" },
  { labelEn: "Length", labelAr: "الطول" },
  { labelEn: "Sleeve", labelAr: "الكم" },
  { labelEn: "Height", labelAr: "الطول (الجسم)" },
];

const emptyRow = (): SizeGuideRow => ({ labelEn: "", labelAr: "", values: {} });
const chestRow = (): SizeGuideRow => ({ labelEn: "Chest", labelAr: "الصدر", values: {} });

/**
 * The product's size chart: one row per measurement, one box per size, in cm. Saved on its own
 * (it never submits the product form around it). Customers see it under the size buttons, after
 * the store-wide line that imported pieces run large.
 */
export function SizeGuideEditor({ productId, sizes, initial }: {
  productId: number;
  sizes: string[];
  initial?: SizeGuide | null;
}) {
  const client = useQueryClient();
  const [kind, setKind] = useState<SizeGuide["kind"]>(initial?.kind ?? "BODY");
  const [rows, setRows] = useState<SizeGuideRow[]>(initial?.rows?.length ? initial.rows : [chestRow()]);
  const [noteEn, setNoteEn] = useState(initial?.noteEn ?? "");
  const [noteAr, setNoteAr] = useState(initial?.noteAr ?? "");
  const [hasGuide, setHasGuide] = useState(Boolean(initial));

  const clean = (): SizeGuide => ({
    kind,
    rows: rows
      .filter((r) => r.labelEn.trim() && r.labelAr.trim())
      .map((r) => ({
        labelEn: r.labelEn.trim(),
        labelAr: r.labelAr.trim(),
        values: Object.fromEntries(sizes.filter((s) => (r.values[s] ?? "").trim()).map((s) => [s, (r.values[s] ?? "").trim()])),
      })),
    noteEn: noteEn.trim() || null,
    noteAr: noteAr.trim() || null,
  });

  const save = useMutation({
    mutationFn: () => api<void>("PUT", `/api/v1/admin/products/${productId}/size-guide`, clean()),
    onSuccess: () => {
      setHasGuide(true);
      client.invalidateQueries({ queryKey: ["admin", "product", String(productId)] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api<void>("DELETE", `/api/v1/admin/products/${productId}/size-guide`),
    onSuccess: () => {
      setHasGuide(false);
      setRows([chestRow()]);
      setNoteEn("");
      setNoteAr("");
      client.invalidateQueries({ queryKey: ["admin", "product", String(productId)] });
    },
  });

  const update = (index: number, change: Partial<SizeGuideRow>) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...change } : row)));
  const usable = clean().rows.length > 0;

  return (
    <section className="border border-line bg-card p-5">
      <h2 className="font-semibold">Size chart</h2>
      <p className="mt-1 text-sm text-stone">
        In cm (shoppers can switch to inches). Shoppers see it under the size buttons, after a line saying imported pieces run about one size large.
        {hasGuide ? " This product has a chart." : " This product has no chart yet."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Start from a standard body chart:</span>
        {(Object.keys(STANDARD_CHARTS) as (keyof typeof STANDARD_CHARTS)[]).map((key) => (
          <button key={key} type="button" className="btn btn-outline"
            onClick={() => {
              setKind("BODY");
              setRows(standardRows(key, sizes));
            }}>
            {STANDARD_CHARTS[key].title}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-stone">Fills the rows below for this product&apos;s sizes. Check the numbers, then save.</p>

      <fieldset className="mt-4 flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">What the numbers measure</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name={`kind-${productId}`} checked={kind === "BODY"} onChange={() => setKind("BODY")} />
          The wearer&apos;s body
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name={`kind-${productId}`} checked={kind === "GARMENT"} onChange={() => setKind("GARMENT")} />
          The piece laid flat
        </label>
      </fieldset>

      <div className="mt-4 overflow-x-auto">
        <table className="text-sm">
          <thead className="text-xs text-stone">
            <tr>
              <th scope="col" className="pe-2 pb-1 text-start font-medium">Measurement (English / Arabic)</th>
              {sizes.map((s) => <th key={s} scope="col" className="px-1 pb-1 font-semibold">{s}</th>)}
              <th scope="col"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td className="py-1 pe-2">
                  <div className="flex gap-1">
                    <input className="field h-9 w-36" aria-label={`Row ${index + 1} name in English`} list="size-guide-presets"
                      value={row.labelEn} maxLength={40}
                      onChange={(e) => {
                        const preset = PRESETS.find((p) => p.labelEn === e.target.value);
                        update(index, preset && !row.labelAr ? { labelEn: e.target.value, labelAr: preset.labelAr } : { labelEn: e.target.value });
                      }} />
                    <input className="field h-9 w-32" dir="rtl" aria-label={`Row ${index + 1} name in Arabic`}
                      value={row.labelAr} maxLength={40} onChange={(e) => update(index, { labelAr: e.target.value })} />
                  </div>
                </td>
                {sizes.map((s) => (
                  <td key={s} className="px-1 py-1">
                    <input className="field h-9 w-20 text-center" dir="ltr" aria-label={`${row.labelEn || "Row"} for size ${s}`}
                      placeholder="94-102" maxLength={20} value={row.values[s] ?? ""}
                      onChange={(e) => update(index, { values: { ...row.values, [s]: e.target.value } })} />
                  </td>
                ))}
                <td className="py-1 ps-1">
                  <button type="button" className="cursor-pointer px-2 text-sm text-danger underline" disabled={rows.length === 1}
                    onClick={() => setRows((list) => list.filter((_, i) => i !== index))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="size-guide-presets">
          {PRESETS.map((p) => <option key={p.labelEn} value={p.labelEn} />)}
        </datalist>
      </div>
      <button type="button" className="btn btn-outline mt-2" disabled={rows.length >= 8} onClick={() => setRows((list) => [...list, emptyRow()])}>
        Add a row
      </button>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Extra note (English, optional)</span>
          <input className="field w-full" maxLength={240} value={noteEn} onChange={(e) => setNoteEn(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Extra note (Arabic, optional)</span>
          <input className="field w-full" dir="rtl" maxLength={240} value={noteAr} onChange={(e) => setNoteAr(e.target.value)} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={!usable || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save size chart"}
        </button>
        {hasGuide && (
          <button type="button" className="cursor-pointer text-sm text-danger underline" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Remove chart
          </button>
        )}
        {save.isSuccess && <span role="status" className="text-sm">Saved.</span>}
        {(save.isError || remove.isError) && <span role="alert" className="text-sm text-danger">{errorText(save.error ?? remove.error)}</span>}
      </div>
    </section>
  );
}
