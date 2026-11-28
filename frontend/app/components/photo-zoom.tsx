import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ProductPhoto } from "~/components/product";
import { useT } from "~/lib/i18n";

/**
 * Product photo zoom.
 *
 * - Computer (a mouse that can hover): the photo zooms where the pointer is, following it, and shows the
 *   original upload at full quality instead of the page-size copy. It is loaded only when the pointer
 *   first rests on the photo.
 * - Everyone (tap, click or Enter): the photo opens full screen, at full quality, with every photo of the
 *   colour. Pinch or double-tap to zoom in, drag to look around, swipe or use the arrows to change photo.
 */

const HOVER_SCALE = 2.4;
const MAX_SCALE = 4;

export function ZoomablePhoto({ url, alt, sizes, eager, onOpen }: {
  url: string;
  alt: string;
  sizes: string;
  eager?: boolean;
  onOpen: () => void;
}) {
  const { t } = useT();
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const [canHover, setCanHover] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    setCanHover(query.matches);
    const change = () => setCanHover(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  const follow = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canHover || e.pointerType !== "mouse") return;
    const box = e.currentTarget.getBoundingClientRect();
    setZoom({
      x: Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - box.top) / box.height) * 100)),
    });
  };

  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerMove={follow}
      onPointerEnter={follow}
      onPointerLeave={() => setZoom(null)}
      aria-label={`${alt} — ${t("product.zoomPhoto")}`}
      className={`relative block w-full overflow-hidden ${canHover ? "cursor-zoom-in" : ""}`}
    >
      <ProductPhoto url={url} alt={alt} sizes={sizes} eager={eager} className="aspect-[4/5] w-full" />
      {zoom && (
        <img
          src={url}
          alt=""
          aria-hidden="true"
          data-zoom-layer
          className="pointer-events-none absolute inset-0 h-full w-full bg-studio object-cover"
          style={{ transform: `scale(${HOVER_SCALE})`, transformOrigin: `${zoom.x}% ${zoom.y}%` }}
        />
      )}
    </button>
  );
}

type View = { scale: number; x: number; y: number };
const REST: View = { scale: 1, x: 0, y: 0 };

/** Keeps a zoomed photo covering its frame: it can be moved only as far as its edges. */
function clamp(view: View, width: number, height: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(1, view.scale));
  const maxX = ((scale - 1) * width) / 2;
  const maxY = ((scale - 1) * height) / 2;
  return { scale, x: Math.min(maxX, Math.max(-maxX, view.x)), y: Math.min(maxY, Math.max(-maxY, view.y)) };
}

export function PhotoViewer({ images, start, name, onClose }: {
  images: { url: string; alt: string }[];
  start: number;
  name: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);
  const [view, setView] = useState<View>(REST);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; view: View; mid: { x: number; y: number } } | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    // No close() here: closing fires the dialog's close event, which would report a close the shopper
    // never asked for (React runs effects twice in development). Removing the element ends the modal.
    return () => {
      root.style.overflow = before;
    };
  }, []);

  const go = (step: number) => {
    setIndex((i) => (i + step + images.length) % images.length);
    setView(REST);
  };

  const size = () => {
    const box = frame.current?.getBoundingClientRect();
    return { width: box?.width ?? 1, height: box?.height ?? 1, left: box?.left ?? 0, top: box?.top ?? 0 };
  };

  /** Zooms by `factor` keeping the point under (clientX, clientY) where it is. */
  const zoomAt = (from: View, factor: number, clientX: number, clientY: number): View => {
    const { width, height, left, top } = size();
    const scale = Math.min(MAX_SCALE, Math.max(1, from.scale * factor));
    const px = clientX - left - width / 2;
    const py = clientY - top - height / 2;
    const ratio = scale / from.scale;
    return clamp({ scale, x: px - (px - from.x) * ratio, y: py - (py - from.y) * ratio }, width, height);
  };

  const down = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), view, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      swipe.current = null;
    } else if (pointers.current.size === 1) {
      swipe.current = { x: e.clientX, y: e.clientY };
    }
  };

  const move = (e: ReactPointerEvent) => {
    const previous = pointers.current.get(e.pointerId);
    if (!previous) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const factor = Math.hypot(a.x - b.x, a.y - b.y) / gesture.current.distance;
      setView(zoomAt(gesture.current.view, factor, gesture.current.mid.x, gesture.current.mid.y));
    } else if (pointers.current.size === 1 && view.scale > 1) {
      const { width, height } = size();
      setView((v) => clamp({ ...v, x: v.x + e.clientX - previous.x, y: v.y + e.clientY - previous.y }, width, height));
    }
  };

  const up = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    const start = swipe.current;
    swipe.current = null;
    if (!start || pointers.current.size > 0) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (view.scale === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      // Swipe left for the next photo (right in Arabic, where the row runs the other way).
      const rtl = document.documentElement.dir === "rtl";
      go((dx < 0) !== rtl ? 1 : -1);
      return;
    }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        setView((v) => (v.scale > 1 ? REST : zoomAt(v, 2.5, e.clientX, e.clientY)));
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }
  };

  const wheel = (e: React.WheelEvent) => {
    setView((v) => zoomAt(v, e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY));
  };

  const image = images[index]!;
  return (
    <dialog
      ref={dialog}
      aria-label={name}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (images.length < 2) return;
        const rtl = document.documentElement.dir === "rtl";
        if (e.key === "ArrowRight") go(rtl ? -1 : 1);
        if (e.key === "ArrowLeft") go(rtl ? 1 : -1);
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-studio p-0 text-ink backdrop:bg-ink/80"
    >
      <div
        ref={frame}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={wheel}
        className={`absolute inset-0 touch-none select-none overflow-hidden ${view.scale > 1 ? "cursor-grab" : "cursor-zoom-in"}`}
      >
        <img
          key={image.url}
          src={image.url}
          alt={image.alt}
          draggable={false}
          className="h-full w-full object-contain"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: gesture.current || pointers.current.size ? "none" : "transform 200ms ease-out",
          }}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <p className="label rounded-full bg-bone/90 px-3 py-1.5 text-xs" aria-live="polite">
          {t("product.photoOf", { n: index + 1, total: images.length })}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full bg-bone/90 text-xl"
          aria-label={t("product.closeZoom")}
        >
          ×
        </button>
      </div>
      {images.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between px-3">
          <button type="button" onClick={() => go(-1)} aria-label={t("product.previousPhoto")}
            className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full bg-bone/90 text-xl rtl:rotate-180">
            ‹
          </button>
          <button type="button" onClick={() => go(1)} aria-label={t("product.nextPhoto")}
            className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full bg-bone/90 text-xl rtl:rotate-180">
            ›
          </button>
        </div>
      )}
      <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-stone">{t("product.zoomHint")}</p>
    </dialog>
  );
}
