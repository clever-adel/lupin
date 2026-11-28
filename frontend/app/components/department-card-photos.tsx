import { useEffect, useState } from "react";
import { ProductPhoto } from "~/components/product";

/** How long each photo stays before the next fades in. */
const SHOW_MS = 4500;

export type CardSlide = { url: string; kind: "campaign" | "piece" };

/** The owner's wide photo first (when there is one), then the main photo of each of the first pieces. */
export function cardSlides(ownImageUrl: string | undefined, pieceImageUrls: string[] | undefined, imageUrl?: string): CardSlide[] {
  const slides: CardSlide[] = [];
  if (ownImageUrl) slides.push({ url: ownImageUrl, kind: "campaign" });
  for (const url of pieceImageUrls ?? []) {
    if (!slides.some((s) => s.url === url)) slides.push({ url, kind: "piece" });
  }
  // An API from before the photo list: its single photo still shows.
  if (slides.length === 0 && imageUrl) slides.push({ url: imageUrl, kind: "piece" });
  return slides;
}

/** Whether the card shows a piece's photo in a side panel on wider screens, so its words keep clear of it. */
export function pieceSidePanel(slides: CardSlide[]): boolean {
  return slides.some((s) => s.kind === "piece");
}

/**
 * The photos behind a department card on the home page, fading from one to the next every few seconds.
 * A wide photo the owner uploaded fills the card. A piece's photo (tall, on a light studio background)
 * fills the card on phones; on wider screens, where the card is long and short, it stands whole in a
 * studio-coloured panel at the end of the card instead of being cut to a thin strip (the card keeps its
 * words clear of that panel: see `pieceSidePanel`).
 * Stops while the pointer is on the card, while the page is hidden, and for visitors who ask for less motion.
 */
export function DepartmentCardPhotos({ slides, hovering }: { slides: CardSlide[]; hovering: boolean }) {
  const [shown, setShown] = useState(0);
  const [still, setStill] = useState(true);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(query.matches);
    const change = () => setStill(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    if (slides.length < 2 || still || hovering) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setShown((i) => (i + 1) % slides.length);
    }, SHOW_MS);
    return () => window.clearInterval(timer);
  }, [slides.length, still, hovering]);

  if (slides.length === 0) return null;
  return (
    <>
      {slides.map((slide, i) => {
        const on = i === shown % slides.length;
        const fade = `transition-opacity duration-1000 ${on ? "opacity-100" : "opacity-0"}`;
        return slide.kind === "campaign" ? (
          <span key={slide.url} aria-hidden="true" data-card-slide={on ? "on" : "off"} className={`absolute inset-0 ${fade}`}>
            <ProductPhoto url={slide.url} alt="" sizes="(min-width: 768px) 50vw, 100vw"
              className="h-full w-full object-cover opacity-80" />
            <span className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
          </span>
        ) : (
          <span key={slide.url} aria-hidden="true" data-card-slide={on ? "on" : "off"}
            className={`absolute inset-0 md:start-auto md:end-0 md:w-2/5 md:overflow-hidden md:bg-studio ${fade}`}>
            <ProductPhoto url={slide.url} alt="" sizes="(min-width: 768px) 20vw, 100vw"
              className="h-full w-full object-cover object-[50%_25%] opacity-80 md:scale-[1.45] md:object-contain md:opacity-100" />
            {/* Studio shots leave room around the piece: zoomed a little on wide screens so it fills the panel. */}
            <span className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent md:hidden" />
          </span>
        );
      })}
    </>
  );
}
