import { useEffect, useId, useState } from "react";
import { useT } from "~/lib/i18n";
import { HEIGHT_RANGE, recommendSize, WEIGHT_RANGE } from "~/lib/size-finder";
import type { SizeGuide } from "~/lib/types";

const STORE_KEY = "lupin.fit";

function remembered(): { height: string; weight: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as { height?: unknown; weight?: unknown } | null;
    return { height: String(saved?.height ?? ""), weight: String(saved?.weight ?? "") };
  } catch {
    return { height: "", weight: "" };
  }
}

/**
 * "Find my size": the shopper types height and weight and gets a size from this product's own chart,
 * with a button that selects it. Height and weight stay in this browser only, for the next product.
 */
export function SizeFinder({ guide, sizes, department, available, onPick }: {
  guide: SizeGuide;
  sizes: string[];
  department?: string;
  available: (size: string) => boolean;
  onPick: (size: string) => void;
}) {
  const { t } = useT();
  const id = useId();
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    const saved = remembered();
    setHeight(saved.height);
    setWeight(saved.weight);
  }, []);

  const advice = recommendSize(guide, sizes, Number(height), Number(weight), department);
  const usable = guide.kind === "BODY" && guide.rows.some((r) => /chest|bust/i.test(r.labelEn));
  if (!usable) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setAsked(true);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ height: Number(height), weight: Number(weight) }));
    } catch {
      // Private mode or blocked storage: the advice still works, it just is not remembered.
    }
  };

  return (
    <details className="mt-2 border border-line bg-card">
      <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold underline underline-offset-4">
        {t("product.findSize")}
      </summary>
      <form onSubmit={submit} className="border-t border-line px-3 pb-3">
        <p className="mt-3 text-sm text-stone">{t("product.findSizeIntro")}</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm" htmlFor={`${id}-h`}>
            <span className="mb-1 block font-medium">{t("product.findSizeHeight")}</span>
            <input id={`${id}-h`} className="field h-10 w-28" type="number" inputMode="numeric" dir="ltr"
              min={HEIGHT_RANGE.min} max={HEIGHT_RANGE.max} required placeholder="175"
              value={height} onChange={(e) => { setHeight(e.target.value); setAsked(false); }} />
          </label>
          <label className="text-sm" htmlFor={`${id}-w`}>
            <span className="mb-1 block font-medium">{t("product.findSizeWeight")}</span>
            <input id={`${id}-w`} className="field h-10 w-28" type="number" inputMode="numeric" dir="ltr"
              min={WEIGHT_RANGE.min} max={WEIGHT_RANGE.max} required placeholder="70"
              value={weight} onChange={(e) => { setWeight(e.target.value); setAsked(false); }} />
          </label>
          <button type="submit" className="btn btn-primary h-10">{t("product.findSizeGo")}</button>
        </div>

        {asked && (
          <div role="status" className="mt-3 border-s-2 border-gold ps-3 text-sm leading-relaxed">
            {advice?.fit === "tooSmall" ? (
              <>
                <p>{t("product.findSizeTooSmall", { size: advice.size })}</p>
                <p className="mt-1 text-xs text-stone">{t("product.findSizeEstimate", { chest: advice.chest })}</p>
              </>
            ) : advice ? (
              <>
                <p>
                  {t("product.findSizeResult")} <strong dir="ltr" className="text-base">{advice.size}</strong>
                  {advice.fit === "below" && <> — {t("product.findSizeBelow")}</>}
                  {advice.fit === "above" && <> — {t("product.findSizeAbove")}</>}
                </p>
                <p className="mt-1 text-xs text-stone">{t("product.findSizeEstimate", { chest: advice.chest })}</p>
                {available(advice.size) ? (
                  <button type="button" className="btn btn-outline mt-2" onClick={() => onPick(advice.size)}>
                    {t("product.findSizeSelect", { size: advice.size })}
                  </button>
                ) : (
                  <p className="mt-1 text-xs text-danger">{t("product.findSizeSoldOut", { size: advice.size })}</p>
                )}
              </>
            ) : (
              <p>{t("product.findSizeInvalid")}</p>
            )}
          </div>
        )}
      </form>
    </details>
  );
}
