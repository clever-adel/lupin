import { useEffect, useState } from "react";
import { ProductPhoto } from "~/components/product";

/** How long each photo stays (phones) or each wide photo stays (computers) before the next fades in. */
const SHOW_MS = 4500;
/** Seconds the computer strip takes to move by one piece. */
const STRIP_SECONDS_PER_PIECE = 6;
/** The strip repeats its pieces until it holds at least this many, so it always spans a wide card. */
const STRIP_MIN_TILES = 8;

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

/** One pass of the computer strip: the pieces repeated until there are enough to span the card. */
export function stripTiles(pieces: string[]): string[] {
  if (pieces.length === 0) return [];
  const tiles: string[] = [];
  while (tiles.length < STRIP_MIN_TILES) tiles.push(...pieces);
  return tiles;
}

function useMedia(query: string, initial: boolean): boolean {
  const [matches, setMatches] = useState(initial);
  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const change = () => setMatches(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, [query]);
  return matches;
}

/**
 * The photos behind a department card on the home page.
 *
 * - Phones: one photo at a time fills the card (the owner's wide photo, then each piece), fading to the
 *   next every few seconds.
 * - Computers, where the card is long and short: the pieces stand side by side across the whole card,
 *   each whole in its own tile, and the row glides slowly sideways without end. A wide photo the owner
 *   uploaded takes turns with that row.
 *
 * Everything holds still while the pointer is on the card, while the page is hidden, and for visitors who
 * ask for less motion.
 */
export function DepartmentCardPhotos({ slides, hovering }: { slides: CardSlide[]; hovering: boolean }) {
  const wide = useMedia("(min-width: 48rem)", false);
  const still = useMedia("(prefers-reduced-motion: reduce)", true);
  const campaign = slides.find((s) => s.kind === "campaign");
  const pieces = slides.filter((s) => s.kind === "piece").map((s) => s.url);
  // What takes turns: on computers the wide photo and the whole strip; on phones every photo.
  const turns = wide ? (campaign ? 1 : 0) + (pieces.length ? 1 : 0) : slides.length;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    setShown(0);
  }, [wide]);

  useEffect(() => {
    if (turns < 2 || still || hovering) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setShown((i) => (i + 1) % turns);
    }, SHOW_MS);
    return () => window.clearInterval(timer);
  }, [turns, still, hovering]);

  if (slides.length === 0) return null;
  const fade = (on: boolean) => `transition-opacity duration-1000 ${on ? "opacity-100" : "opacity-0"}`;
  const current = shown % Math.max(turns, 1);
  const stripTurn = campaign ? 1 : 0;
  const tiles = stripTiles(pieces);

  return (
    <>
      {/* Phones: one photo at a time. */}
      {slides.map((slide, i) => (
        <span key={`phone-${slide.url}`} aria-hidden="true" data-card-slide={!wide ? (i === current ? "on" : "off") : undefined}
          className={`absolute inset-0 md:hidden ${fade(i === current)}`}>
          <ProductPhoto url={slide.url} alt="" sizes="100vw"
            className={`h-full w-full object-cover opacity-80 ${slide.kind === "piece" ? "object-[50%_25%]" : ""}`} />
        </span>
      ))}

      {/* Computers: the owner's wide photo, taking turns with the strip of pieces. */}
      {campaign && (
        <span aria-hidden="true" data-card-slide={wide ? (current === 0 ? "on" : "off") : undefined}
          className={`absolute inset-0 max-md:hidden ${fade(current === 0)}`}>
          <ProductPhoto url={campaign.url} alt="" sizes="100vw" className="h-full w-full object-cover opacity-80" />
        </span>
      )}
      {tiles.length > 0 && (
        <span aria-hidden="true" data-card-slide={wide ? (current === stripTurn ? "on" : "off") : undefined} data-card-strip
          className={`absolute inset-0 overflow-hidden bg-studio max-md:hidden ${fade(current === stripTurn)}`}>
          <span
            className="card-strip flex h-full w-max"
            style={{
              animationDuration: `${tiles.length * STRIP_SECONDS_PER_PIECE}s`,
              animationPlayState: hovering || still ? "paused" : "running",
            }}
          >
            {[...tiles, ...tiles].map((url, i) => (
              <span key={i} className="aspect-[4/5] h-full shrink-0 border-e border-bone/70">
                <ProductPhoto url={url} alt="" sizes="20vw" className="h-full w-full object-cover" />
              </span>
            ))}
          </span>
        </span>
      )}

      {/* Keeps the card's words readable over any photo: the name on the start side, the link along the bottom. */}
      <span aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent md:bg-gradient-to-r md:from-ink/90 md:via-ink/30 md:via-35% md:to-transparent" />
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-ink/85 to-transparent max-md:hidden" />
    </>
  );
}
