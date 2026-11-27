import { useState } from "react";
import { useT, type MessageKey } from "~/lib/i18n";
import { cmToInches, INTERNATIONAL_COLUMNS, internationalRows, sizeGroups } from "~/lib/size-chart";
import type { SizeGuide } from "~/lib/types";

const HOW_TO: { match: RegExp; key: MessageKey }[] = [
  { match: /chest|bust/i, key: "product.sizeGuideHowChest" },
  { match: /waist/i, key: "product.sizeGuideHowWaist" },
  { match: /hip/i, key: "product.sizeGuideHowHips" },
];

const tab = (active: boolean) =>
  `min-h-9 cursor-pointer border px-3 text-xs font-semibold ${active ? "border-ink bg-ink text-bone" : "border-line bg-card hover:border-ink"}`;

/**
 * The size chart under the size buttons. Always says first that imported pieces run large, then the
 * product's own table: sizes across (split into tabs when there are many), measurements down, in cm
 * or inches. Body charts add how to measure; women's pieces add the international size conversion.
 * Closed until tapped.
 */
export function SizeGuidePanel({ guide, sizes, department }: { guide: SizeGuide; sizes: string[]; department?: string }) {
  const { t, pick } = useT();
  const [unit, setUnit] = useState<"cm" | "in">("cm");
  const groups = sizeGroups(sizes);
  const [groupIndex, setGroupIndex] = useState(0);
  const shown = groups[Math.min(groupIndex, groups.length - 1)]?.sizes ?? sizes;
  const note = pick(guide, "note");
  const howTo = guide.kind === "BODY" ? HOW_TO.filter((h) => guide.rows.some((r) => h.match.test(r.labelEn))) : [];
  const international = department === "women" ? internationalRows(sizes) : [];

  return (
    <details className="mt-3 border border-line bg-card">
      <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold underline underline-offset-4">
        {t("product.sizeGuide")}
      </summary>
      <div className="border-t border-line px-3 pb-3">
        <p className="mt-3 border-s-2 border-gold ps-3 text-sm leading-relaxed">{t("product.sizeGuideImported")}</p>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {groups.length > 1 ? (
            <div role="group" aria-label={t("product.sizeGuideRange")} className="flex flex-wrap gap-1">
              {groups.map((g, i) => (
                <button key={g.label} type="button" dir="ltr" aria-pressed={i === groupIndex} className={tab(i === groupIndex)}
                  onClick={() => setGroupIndex(i)}>
                  {g.label}
                </button>
              ))}
            </div>
          ) : <span />}
          <div role="group" aria-label={t("product.sizeGuideUnits")} className="flex gap-1" dir="ltr">
            {(["cm", "in"] as const).map((u) => (
              <button key={u} type="button" aria-pressed={unit === u} className={tab(unit === u)} onClick={() => setUnit(u)}>
                {u}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="pb-2 text-start text-xs text-stone">
              {t(guide.kind === "BODY" ? "product.sizeGuideBody" : "product.sizeGuideGarment")} ({unit})
            </caption>
            <thead>
              <tr className="border-b border-line text-xs text-stone">
                <th scope="col" className="py-1.5 pe-3 text-start font-medium">{t("product.sizeGuideMeasure")}</th>
                {shown.map((s) => (
                  <th key={s} scope="col" dir="ltr" className="px-2 py-1.5 text-center font-semibold text-ink">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guide.rows.map((row) => (
                <tr key={row.labelEn} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2 pe-3 text-start font-normal">{pick(row, "label")}</th>
                  {shown.map((s) => {
                    const value = row.values[s];
                    return (
                      <td key={s} dir="ltr" className="whitespace-nowrap px-2 py-2 text-center">
                        {value ? (unit === "in" ? cmToInches(value) : value) : "–"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {note && <p className="mt-2 text-xs leading-relaxed text-stone">{note}</p>}

        {howTo.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide">{t("product.sizeGuideHowTo")}</h3>
            <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm leading-relaxed">
              {howTo.map((h) => <li key={h.key}>{t(h.key)}</li>)}
            </ol>
          </div>
        )}

        {international.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide">{t("product.sizeGuideInternational")}</h3>
            <div className="mt-2 overflow-x-auto" dir="ltr">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-stone">
                    <th scope="col" className="py-1.5 pe-2 text-start font-medium">{t("product.size")}</th>
                    {INTERNATIONAL_COLUMNS.map((c) => <th key={c} scope="col" className="px-1.5 py-1.5 text-center font-medium">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {international.map((row) => (
                    <tr key={`${row.size}-${row.values[0]}`} className="border-b border-line last:border-0">
                      <th scope="row" className="py-1.5 pe-2 text-start font-semibold">{row.size}</th>
                      {row.values.map((v, i) => <td key={INTERNATIONAL_COLUMNS[i]} className="px-1.5 py-1.5 text-center">{v}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
