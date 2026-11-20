import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FREE_DELIVERY_OVER, PRODUCTS, categoryLabel, egp, findProduct } from "../data";
import { I, Illustration, Price, ProductCard, Qty, SectionHead } from "../components/ui";
import { useStore } from "../store";
import NotFound from "./NotFound";

export default function ProductPage() {
  const { slug = "" } = useParams();
  const p = findProduct(slug);
  if (!p) return <NotFound />;
  return <ProductView key={p.slug} slug={p.slug} />;
}

function ProductView({ slug }: { slug: string }) {
  const p = findProduct(slug)!;
  const { stock, available, addToCart, wishlist, toggleWish, setCartOpen, toast } = useStore();
  const [img, setImg] = useState(0);
  const [size, setSize] = useState<string | null>(p.sizes.length === 1 ? p.sizes[0] : null);
  const [qty, setQty] = useState(1);
  const [sizeError, setSizeError] = useState(false);
  const [open, setOpen] = useState<string | null>("details");
  const touchX = useRef<number | null>(null);

  const wished = wishlist.includes(p.slug);
  const imgs = p.kind === "real" ? p.images : [];
  const count = Math.max(1, imgs.length);
  const left = size ? available(p.slug, size) : 0;
  const inSizeStock = size ? stock[p.slug]?.[size] ?? 0 : 0;
  const allOut = p.sizes.every((s) => (stock[p.slug]?.[s] ?? 0) === 0);

  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => { if (size && qty > Math.max(1, left)) setQty(Math.max(1, left)); }, [size, left, qty]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,select,textarea")) return;
      if (e.key === "ArrowRight") setImg((i) => (i + 1) % count);
      if (e.key === "ArrowLeft") setImg((i) => (i - 1 + count) % count);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [count]);

  const add = () => {
    if (!size) { setSizeError(true); return; }
    if (addToCart(p.slug, size, qty)) {
      toast(`${p.name} · ${size} added to cart`, { label: "View cart", run: () => setCartOpen(true) });
      setCartOpen(true);
      setQty(1);
    } else {
      toast(`No more ${size} in stock`);
    }
  };

  const related = PRODUCTS.filter((x) => x.slug !== p.slug && (x.category === p.category || x.mission === p.mission)).slice(0, 4);

  const acc = [
    { id: "details", title: "Details", body: <><p>{p.description}</p><ul>{p.details.map((d) => <li key={d}>{d}</li>)}</ul><p className="muted">Colour: {p.colour}</p></> },
    { id: "delivery", title: "Delivery", body: <p>Delivered anywhere in Egypt, usually within 3–7 days. EGP 75 delivery, free on orders over {egp(FREE_DELIVERY_OVER)}. Every order is packed in the LUPIN. black bag with the gold seal.</p> },
    { id: "returns", title: "Returns & exchanges", body: <p>Returns and exchanges are handled according to the Egyptian Consumer Protection Law (No. 181 of 2018). Items must be unworn, with tags. <Link to="/policies#returns">Read the full policy</Link>.</p> },
    { id: "payment", title: "Payment", body: <p>Secure online payment through Paymob — card or mobile wallet. <strong>Demo mode:</strong> the checkout is a simulation and no money is taken.</p> },
  ];

  return (
    <div className="page product wrap">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link><span>/</span><Link to={`/shop?category=${p.category}`}>{categoryLabel(p.category)}</Link><span>/</span><span aria-current="page">{p.name}</span>
      </nav>
      <div className="pdp">
        {/* ---------- Gallery ---------- */}
        <div className="gallery">
          {imgs.length > 1 && (
            <div className="thumbs" role="tablist" aria-label="Product images">
              {imgs.map((src, i) => (
                <button key={src} type="button" role="tab" aria-selected={i === img} aria-label={`Image ${i + 1} of ${imgs.length}`} className={`thumb ${i === img ? "on" : ""}`} onClick={() => setImg(i)}>
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}
          <div
            className="stage"
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              if (touchX.current === null) return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              if (Math.abs(dx) > 40) setImg((i) => (i + (dx < 0 ? 1 : -1) + count) % count);
              touchX.current = null;
            }}
          >
            {p.kind === "real" ? (
              imgs.map((src, i) => <img key={src} src={src} alt={`${p.name} — ${p.piece}, image ${i + 1}`} className={i === img ? "on" : ""} />)
            ) : (
              <Illustration p={p} />
            )}
            <span className={`stage-label ${p.kind}`}>
              {p.kind === "real" ? <><I.check width={14} /> Actual product photo</> : <>Demo item · illustration, not a product photo</>}
            </span>
            {imgs.length > 1 && (
              <>
                <button type="button" className="stage-nav prev" aria-label="Previous image" onClick={() => setImg((i) => (i - 1 + count) % count)}><I.left /></button>
                <button type="button" className="stage-nav next" aria-label="Next image" onClick={() => setImg((i) => (i + 1) % count)}><I.right /></button>
                <div className="dots" aria-hidden>{imgs.map((_, i) => <span key={i} className={i === img ? "on" : ""} />)}</div>
              </>
            )}
          </div>
        </div>

        {/* ---------- Buy box ---------- */}
        <div className="buy">
          <div className="buy-sticky">
            <div className="buy-tags">
              {p.mission && <Link to={`/shop?mission=${p.mission}`} className="tag">Mission 00{p.mission}</Link>}
              {p.kind === "demo" ? <span className="tag tag-demo">Demo item — sample product</span> : <span className="tag">Original {p.maker}</span>}
            </div>
            <span className="buy-op">Operation</span>
            <h1 className="buy-name">{p.name}</h1>
            <p className="buy-piece">{p.piece} · by {p.maker}</p>
            <Price p={p} large />
            {p.compareAt && <p className="save">You save {egp(p.compareAt - p.price)}</p>}

            <div className="size-head">
              <span id="size-label">Size{size && <>: <strong>{size}</strong></>}</span>
              <span className="muted small">{p.kind === "demo" ? "Sample sizing" : p.details[0]}</span>
            </div>
            <div className={`sizes ${sizeError ? "err" : ""}`} role="radiogroup" aria-labelledby="size-label">
              {p.sizes.map((s) => {
                const n = stock[p.slug]?.[s] ?? 0;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={size === s}
                    disabled={n === 0}
                    className={`size ${size === s ? "on" : ""}`}
                    onClick={() => { setSize(s); setSizeError(false); }}
                    aria-label={n === 0 ? `${s}, sold out` : s}
                  >
                    {s}{n > 0 && n <= 2 && <i className="size-low" aria-hidden />}
                  </button>
                );
              })}
            </div>
            <p className={`stock-line ${sizeError ? "err" : ""}`} aria-live="polite">
              {sizeError ? "Please choose a size." : allOut ? "Sold out in every size." : size ? (inSizeStock === 0 ? "Sold out" : inSizeStock <= 2 ? `Only ${inSizeStock} left in ${size}` : `In stock · ${inSizeStock} available`) : "Select a size to see availability."}
            </p>

            <div className="buy-row">
              <Qty value={qty} max={Math.max(1, left)} onChange={setQty} label="Quantity" />
              <button type="button" className="btn btn-dark btn-grow" onClick={add} disabled={allOut || (size !== null && left <= 0)}>
                {allOut ? "Sold out" : size !== null && left <= 0 ? "All in your cart" : <>Add to cart · {egp(p.price * qty)}</>}
              </button>
              <button type="button" className={`btn-icon-square ${wished ? "on" : ""}`} aria-pressed={wished} aria-label={wished ? "Remove from wishlist" : "Save to wishlist"} onClick={() => { toggleWish(p.slug); toast(wished ? "Removed from wishlist" : "Saved to wishlist"); }}>
                <I.heart filled={wished} />
              </button>
            </div>

            <ul className="perks">
              <li><I.truck width={18} /> Delivery across Egypt in 3–7 days</li>
              <li><I.shield width={18} /> Returns per Egyptian consumer protection law</li>
              <li><I.card width={18} /> Pay securely with Paymob <em>(demo)</em></li>
            </ul>

            <div className="accordion">
              {acc.map((a) => (
                <div key={a.id} className={`acc ${open === a.id ? "open" : ""}`}>
                  <button type="button" aria-expanded={open === a.id} aria-controls={`acc-${a.id}`} onClick={() => setOpen(open === a.id ? null : a.id)}>
                    {a.title}<I.plus width={16} />
                  </button>
                  <div id={`acc-${a.id}`} className="acc-body" hidden={open !== a.id}>{a.body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="section">
          <SectionHead kicker="Complete the look" title={<>You may also <em>steal</em></>} />
          <div className="grid">{related.map((r) => <ProductCard key={r.id} p={r} />)}</div>
        </section>
      )}
    </div>
  );
}
