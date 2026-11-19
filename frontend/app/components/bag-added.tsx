import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useT } from "~/lib/i18n";
import { photoUrl } from "~/lib/photo-sizes";

/** What was just put in the bag, and where its photo was on screen (for the flight to the bag icon). */
export interface BagAdded {
  imageUrl?: string;
  name: string;
  colour: string;
  size: string;
  quantity: number;
  from?: { x: number; y: number; width: number; height: number };
}

const EVENT = "lupin:bag-added";

/** Called by any page that adds to the bag; the header shows the feedback. */
export function announceBagAdded(detail: BagAdded) {
  window.dispatchEvent(new CustomEvent<BagAdded>(EVENT, { detail }));
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Feedback when something is added to the bag:
 * the product photo flies into the bag icon, the icon gives a small bounce, and a card confirms the
 * item (photo, name, colour, size) with a link to the bag. The card closes on its own after a few
 * seconds, stays while pointed at or focused, and can be closed. Reduced motion: card only, no flight.
 */
export function BagAddedFeedback() {
  const { t, href } = useT();
  const [item, setItem] = useState<BagAdded | null>(null);
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(72);
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const { pathname } = useLocation();

  // Going to another page (the bag, say) closes the card instead of leaving it over the new page.
  useEffect(() => {
    window.clearTimeout(timer.current);
    held.current = false;
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const close = () => setOpen(false);
    const startTimer = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (!held.current) close();
      }, 4500);
    };
    const onAdded = (e: Event) => {
      const detail = (e as CustomEvent<BagAdded>).detail;
      // Just under the header, whatever its height (it is taller on phones, with the menu row).
      const header = document.querySelector("header");
      setTop(Math.max(0, Math.round(header ? header.getBoundingClientRect().bottom : 0)) + 8);
      setItem(detail);
      setOpen(true);
      startTimer();
      const icon = document.querySelector<HTMLElement>("[data-bag-icon]");
      if (!icon || reducedMotion()) return;
      const bump = () => {
        icon.classList.remove("bag-bump");
        void icon.offsetWidth; // restart the animation if it is still running
        icon.classList.add("bag-bump");
      };
      if (!detail.from || !detail.imageUrl) {
        bump();
        return;
      }
      // The flight: a copy of the photo shrinks into the bag icon along a gentle curve.
      const to = icon.getBoundingClientRect();
      const ghost = document.createElement("img");
      ghost.src = detail.imageUrl;
      ghost.alt = "";
      ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, {
        position: "fixed", left: `${detail.from.x}px`, top: `${detail.from.y}px`,
        width: `${detail.from.width}px`, height: `${detail.from.height}px`,
        objectFit: "cover", zIndex: "60", pointerEvents: "none", borderRadius: "2px",
        boxShadow: "0 12px 30px rgba(0,0,0,.25)", transformOrigin: "top left",
      });
      document.body.appendChild(ghost);
      const dx = to.left + to.width / 2 - (detail.from.x + detail.from.width * 0.06);
      const dy = to.top + to.height / 2 - (detail.from.y + detail.from.height * 0.06);
      const flight = ghost.animate(
        [
          { transform: "translate(0,0) scale(1)", opacity: 1, borderRadius: "2px" },
          { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - 40}px) scale(.45)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${dx}px, ${dy}px) scale(.06)`, opacity: 0.35, borderRadius: "50%" },
        ],
        { duration: 750, easing: "cubic-bezier(.5,0,.2,1)" },
      );
      flight.onfinish = () => {
        ghost.remove();
        bump();
      };
    };
    window.addEventListener(EVENT, onAdded);
    return () => {
      window.removeEventListener(EVENT, onAdded);
      window.clearTimeout(timer.current);
    };
  }, []);

  const hold = (on: boolean) => {
    held.current = on;
    if (!on) {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setOpen(false), 2500);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-end px-4 md:px-8"
      style={{ top }}
    >
      {item && (
        <div
          className={`bag-added-card pointer-events-auto w-full max-w-sm border border-line bg-card p-4 text-ink shadow-xl ${open ? "is-open" : ""}`}
          aria-hidden={!open}
          onMouseEnter={() => hold(true)}
          onMouseLeave={() => hold(false)}
          onFocus={() => hold(true)}
          onBlur={() => hold(false)}
        >
          <div className="flex items-start gap-3">
            {item.imageUrl ? (
              <img src={photoUrl(item.imageUrl, 320)} alt="" className="h-20 w-16 shrink-0 bg-studio object-cover" />
            ) : (
              <span className="h-20 w-16 shrink-0 bg-studio" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="label flex items-center gap-1.5">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="shrink-0">
                  <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t("added.title")}
              </p>
              <p className="mt-1.5 truncate text-sm font-medium">{item.name}</p>
              <p className="mt-0.5 text-xs text-stone">
                {item.colour} · <span dir="ltr">{item.size}</span>
                {item.quantity > 1 && <> · ×{item.quantity}</>}
              </p>
            </div>
            <button
              type="button"
              className="-me-1 -mt-1 grid h-8 w-8 shrink-0 cursor-pointer place-items-center text-stone hover:text-ink"
              aria-label={t("added.close")}
              tabIndex={open ? 0 : -1}
              onClick={() => setOpen(false)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <Link
            to={href("/bag")}
            tabIndex={open ? 0 : -1}
            onClick={() => setOpen(false)}
            className="btn btn-primary mt-4 w-full"
          >
            {t("added.view")}
          </Link>
        </div>
      )}
    </div>
  );
}
