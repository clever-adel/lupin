import { useEffect, useRef, useState, type ReactNode, type SVGProps } from "react";
import { Link } from "react-router-dom";
import { discountPct, egp, type Product, type Shape } from "../data";
import { useStore } from "../store";

/* ---------------- Icons ---------------- */
const base = (p: SVGProps<SVGSVGElement>) => ({ width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p });
export const I = {
  search: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>,
  bag: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>,
  heart: ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => <svg {...base(p)} fill={filled ? "currentColor" : "none"}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>,
  menu: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 7h18M3 12h18M3 17h12" /></svg>,
  close: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>,
  arrow: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  left: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m15 6-6 6 6 6" /></svg>,
  right: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m9 6 6 6-6 6" /></svg>,
  minus: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 12h12" /></svg>,
  plus: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 12h12M12 6v12" /></svg>,
  truck: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>,
  shield: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>,
  refresh: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" /></svg>,
  card: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h3" /></svg>,
  phone: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></svg>,
  check: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m5 12 4.5 4.5L19 7" /></svg>,
  filter: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 6h16M7 12h10M10 18h4" /></svg>,
  lock: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>,
  key: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></svg>,
};

/* ---------------- Brand ---------------- */
export function Logo({ height = 22 }: { height?: number }) {
  return <img src="./brand/lupin-wordmark.png" alt="LUPIN WEAR" height={height} style={{ height, width: "auto", display: "block" }} />;
}

/* ---------------- Reveal on scroll ---------------- */
export function Reveal({ children, delay = 0, className = "", as: Tag = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "section" | "li" }) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref as never} className={`reveal ${shown ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/* ---------------- Illustration for demo items (never a photograph) ---------------- */
const SHAPES: Record<Shape, ReactNode> = {
  tee: <path d="M128 92 172 70q28 26 56 0l44 22 58 62-38 34-20-18v252H128V170l-20 18-38-34Z" />,
  overshirt: <path d="M130 86 176 66l24 30 24-30 46 20 52 70-6 250h-34l-4-238v258H136V168l-4 238H98l-6-250Z" />,
  coat: <path d="M136 80 178 62l22 70 22-70 42 18 50 80-8 300h-32l-6-270v300H136V190l-6 270H98l-8-300Z" />,
  cargo: <path d="M140 74h120l18 360h-62l-16-250-16 250h-62Z" />,
  cap: <path d="M108 280q0-130 92-134 92 4 92 134Zm-6 2q100-22 236 18-34 26-130 14-62-8-106-32Z" />,
  bag: <path d="M118 236h164q10 0 10 10v116q0 10-10 10H118q-10 0-10-10V246q0-10 10-10Zm4 0q20-140 78-150t78 150h-12q-18-132-66-138t-66 138Z" />,
  beanie: <path d="M128 300q0-166 72-166t72 166Zm-6 0h156v52H122Z" />,
};
const DETAILS: Partial<Record<Shape, ReactNode>> = {
  tee: <><path d="M172 70q28 30 56 0" /><text x="200" y="150" textAnchor="middle">LUPIN.</text></>,
  overshirt: <><path d="M200 96v330" /><rect x="150" y="150" width="34" height="38" /><rect x="216" y="150" width="34" height="38" /><circle cx="200" cy="200" r="3" /><circle cx="200" cy="260" r="3" /><circle cx="200" cy="320" r="3" /></>,
  coat: <><path d="M178 62l22 70 22-70M200 132v330" /><path d="M150 330h30M220 330h30" /></>,
  cargo: <><path d="M140 110h120" /><rect x="142" y="230" width="38" height="56" /><rect x="220" y="230" width="38" height="56" /></>,
  cap: <><path d="M200 146v134M150 160q-14 50-12 120M250 160q14 50 12 120" /><circle cx="200" cy="146" r="4" /></>,
  bag: <><rect x="182" y="286" width="36" height="8" /><path d="M118 270h164" /></>,
  beanie: <><path d="M146 300v52M170 300v52M194 300v52M218 300v52M242 300v52M266 300v52" /></>,
};
export function Illustration({ p, label = true }: { p: Product; label?: boolean }) {
  const ill = p.illustration!;
  return (
    <div className="illus" style={{ ["--ill-fill" as string]: ill.fill, ["--ill-accent" as string]: ill.accent }}>
      <svg viewBox="0 0 400 500" role="img" aria-label={`Illustration of ${p.piece} (demo item, not a product photo)`}>
        <defs>
          <linearGradient id={`g-${p.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={ill.fill} />
            <stop offset="1" stopColor={ill.accent} />
          </linearGradient>
        </defs>
        <ellipse cx="200" cy="468" rx="130" ry="10" fill="rgba(0,0,0,.08)" />
        <g fill={`url(#g-${p.id})`} stroke="rgba(0,0,0,.25)" strokeWidth="1.2">{SHAPES[ill.shape]}</g>
        <g fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1.2" strokeDasharray="4 4" className="ill-detail">{DETAILS[ill.shape]}</g>
      </svg>
      {label && <span className="illus-tag">Illustration · demo item</span>}
    </div>
  );
}

export function ProductVisual({ p, index = 0, sizes }: { p: Product; index?: number; sizes?: string }) {
  if (p.kind === "demo") return <Illustration p={p} />;
  return <img src={p.images[index] ?? p.images[0]} alt={`${p.name} — ${p.piece}`} loading="lazy" decoding="async" sizes={sizes} />;
}

/* ---------------- Price ---------------- */
export function Price({ p, large }: { p: Product; large?: boolean }) {
  const pct = discountPct(p);
  return (
    <span className={`price ${large ? "price-lg" : ""}`}>
      <span className="now">{egp(p.price)}</span>
      {p.compareAt && <s className="was">{egp(p.compareAt)}</s>}
      {pct > 0 && <span className="pct">−{pct}%</span>}
    </span>
  );
}

/* ---------------- Product card ---------------- */
export function ProductCard({ p }: { p: Product }) {
  const { wishlist, toggleWish, inStock, toast, stock } = useStore();
  const wished = wishlist.includes(p.slug);
  const soldOut = !inStock(p);
  const totalLeft = p.sizes.reduce((n, s) => n + (stock[p.slug]?.[s] ?? 0), 0);
  return (
    <article className={`card ${soldOut ? "sold-out" : ""}`}>
      <Link to={`/product/${p.slug}`} className="card-media" aria-label={`${p.name}, ${p.piece}`}>
        <div className="card-img a"><ProductVisual p={p} /></div>
        {p.kind === "real" && p.images[1] && <div className="card-img b"><img src={p.images[1]} alt="" loading="lazy" decoding="async" /></div>}
        <div className="card-badges">
          {p.kind === "demo" ? <span className="badge badge-demo">Demo item</span> : <span className="badge badge-real">Real piece</span>}
          {soldOut ? <span className="badge badge-dark">Sold out</span> : totalLeft <= 4 ? <span className="badge badge-gold">Last pieces</span> : null}
        </div>
      </Link>
      <button
        type="button"
        className={`wish ${wished ? "on" : ""}`}
        aria-pressed={wished}
        aria-label={wished ? `Remove ${p.name} from wishlist` : `Save ${p.name} to wishlist`}
        onClick={() => { toggleWish(p.slug); toast(wished ? `${p.name} removed from wishlist` : `${p.name} saved to wishlist`); }}
      >
        <I.heart filled={wished} />
      </button>
      <Link to={`/product/${p.slug}`} className="card-body">
        <span className="card-op">Operation</span>
        <h3 className="card-name">{p.name}</h3>
        <span className="card-piece">{p.piece} · {p.maker}</span>
        <Price p={p} />
      </Link>
    </article>
  );
}

/* ---------------- Section heading ---------------- */
export function SectionHead({ kicker, title, action }: { kicker: string; title: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <span className="kicker">{kicker}</span>
        <h2 className="h2">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/* ---------------- Quantity ---------------- */
export function Qty({ value, max, onChange, label }: { value: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="qty" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label="Decrease quantity"><I.minus width={16} /></button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase quantity"><I.plus width={16} /></button>
    </div>
  );
}

/* ---------------- Toasts ---------------- */
export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <I.check width={16} />
          <span>{t.text}</span>
          {t.action && <button type="button" onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Body scroll lock for overlays ---------------- */
export function useLockScroll(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [on]);
}

export function useEscape(on: boolean, fn: () => void) {
  useEffect(() => {
    if (!on) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") fn(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [on, fn]);
}
