import { useT } from "~/lib/i18n";
import type { SizeGuide } from "~/lib/types";

/**
 * The size chart under the size buttons. Always says first that imported pieces run large, then the
 * product's own table (sizes across, measurements down) and its note. Closed until tapped.
 */
export function SizeGuidePanel({ guide, sizes }: { guide: SizeGuide; sizes: string[] }) {
  const { t, pick } = useT();
  const note = pick(guide, "note");
  return (
    <details className="mt-3 border border-line bg-card">
      <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold underline underline-offset-4">
        {t("product.sizeGuide")}
      </summary>
      <div className="border-t border-line px-3 pb-3">
        <p className="mt-3 border-s-2 border-gold ps-3 text-sm leading-relaxed">{t("product.sizeGuideImported")}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="pb-2 text-start text-xs text-stone">
              {t(guide.kind === "BODY" ? "product.sizeGuideBody" : "product.sizeGuideGarment")}
            </caption>
            <thead>
              <tr className="border-b border-line text-xs text-stone">
                <th scope="col" className="py-1.5 pe-3 text-start font-medium">{t("product.sizeGuideMeasure")}</th>
                {sizes.map((s) => (
                  <th key={s} scope="col" dir="ltr" className="px-2 py-1.5 text-center font-semibold text-ink">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guide.rows.map((row) => (
                <tr key={row.labelEn} className="border-b border-line last:border-0">
                  <th scope="row" className="py-2 pe-3 text-start font-normal">{pick(row, "label")}</th>
                  {sizes.map((s) => (
                    <td key={s} dir="ltr" className="whitespace-nowrap px-2 py-2 text-center">{row.values[s] ?? "–"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {note && <p className="mt-2 text-xs leading-relaxed text-stone">{note}</p>}
      </div>
    </details>
  );
}
