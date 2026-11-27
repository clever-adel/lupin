import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { CATEGORIES, FREE_DELIVERY_OVER, PRODUCTS, egp, findProduct } from "../data";
import { useStore } from "../store";
import { I, Logo, ProductVisual, Qty, useEscape, useLockScroll } from "./ui";

/* ---------------- Demo mode bar ---------------- */
export function DemoBar() {
  const { reset, toast } = useStore();
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="demobar" role="region" aria-label="Demo mode">
      <span className="demobar-dot" aria-hidden />
      <strong>Demo mode</strong>
      <span className="demobar-text">No real payments, orders or customer data. Sample products and inventory.</span>
      {confirming ? (
        <span className="demobar-confirm">
          Clear cart, wishlist, stock and demo orders?
          <button type="button" onClick={() => { reset(); setConfirming(false); navigate("/"); toast("Demo reset to its starting state"); }}>Yes, reset</button>
          <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
        </span>
      ) : (
        <button type="button" className="demobar-reset" onClick={() => setConfirming(true)}><I.refresh width={14} /> Reset demo</button>
      )}
    </div>
  );
}

/* ---------------- Header ---------------- */
const NAV = [
  { to: "/shop", label: "Shop" },
  { to: "/shop?sort=new", label: "New In" },
  { to: "/heist", label: "The Heist" },
  { to: "/story", label: "Story" },
  { to: "/policies", label: "Service" },
];

export function Header() {
  const { cartCount, wishlist, setCartOpen } = useStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  const overHero = loc.pathname === "/" || loc.pathname === "/heist";

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => { setMenuOpen(false); setSearchOpen(false); }, [loc.pathname, loc.search]);

  return (
    <>
      <header className={`header ${overHero && !scrolled ? "clear" : ""}`}>
        <div className="header-in">
          <button type="button" className="icon-btn only-mobile" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><I.menu /></button>
          <nav className="nav only-desktop" aria-label="Main">
            {NAV.slice(0, 3).map((n) => <NavLink key={n.label} to={n.to} className="nav-link" end>{n.label}</NavLink>)}
          </nav>
          <Link to="/" className="brand" aria-label="LUPIN WEAR home"><Logo height={18} /><span className="brand-wear">WEAR</span></Link>
          <div className="header-actions">
            <nav className="nav only-desktop" aria-label="More">
              {NAV.slice(3).map((n) => <NavLink key={n.label} to={n.to} className="nav-link">{n.label}</NavLink>)}
            </nav>
            <button type="button" className="icon-btn" aria-label="Search" onClick={() => setSearchOpen(true)}><I.search /></button>
            <Link to="/wishlist" className="icon-btn" aria-label={`Wishlist, ${wishlist.length} items`}>
              <I.heart />{wishlist.length > 0 && <span className="count">{wishlist.length}</span>}
            </Link>
            <button type="button" className="icon-btn" aria-label={`Cart, ${cartCount} items`} onClick={() => setCartOpen(true)}>
              <I.bag />{cartCount > 0 && <span className="count">{cartCount}</span>}
            </button>
          </div>
        </div>
      </header>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

/* ---------------- Search ---------------- */
export function searchProducts(q: string) {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return PRODUCTS.filter((p) => [p.name, p.piece, p.maker, p.category, p.colour, p.description].join(" ").toLowerCase().includes(t));
}

function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const results = useMemo(() => searchProducts(q).slice(0, 6), [q]);
  useLockScroll(open);
  useEscape(open, onClose);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 60); else setQ(""); }, [open]);
  if (!open) return null;
  const submit = (e: FormEvent) => { e.preventDefault(); navigate(`/shop?q=${encodeURIComponent(q.trim())}`); onClose(); };
  return (
    <div className="overlay search" role="dialog" aria-modal="true" aria-label="Search">
      <div className="search-in">
        <form onSubmit={submit} className="search-form" role="search">
          <I.search width={22} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hoodies, jackets, operations…" aria-label="Search products" />
          <button type="button" className="icon-btn" aria-label="Close search" onClick={onClose}><I.close /></button>
        </form>
        {q.trim() === "" ? (
          <div className="search-suggest">
            <span className="kicker">Popular</span>
            <div className="chips">
              {["Hoodie", "Jacket", "The Alibi", "Black", "Bershka", "Cap"].map((s) => <button key={s} type="button" className="chip" onClick={() => setQ(s)}>{s}</button>)}
            </div>
          </div>
        ) : results.length === 0 ? (
          <p className="search-empty">No pieces match “{q}”. Try “hoodie” or “jacket”.</p>
        ) : (
          <>
            <ul className="search-results">
              {results.map((p) => (
                <li key={p.id}>
                  <Link to={`/product/${p.slug}`} onClick={onClose}>
                    <span className="sr-thumb"><ProductVisual p={p} /></span>
                    <span><strong>{p.name}</strong><small>{p.piece}</small></span>
                    <span className="sr-price">{egp(p.price)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <button type="submit" className="link-arrow" onClick={submit}>See all results <I.arrow width={16} /></button>
          </>
        )}
      </div>
      <button type="button" className="overlay-scrim" aria-label="Close search" onClick={onClose} />
    </div>
  );
}

/* ---------------- Mobile menu ---------------- */
function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  useLockScroll(open);
  useEscape(open, onClose);
  return (
    <div className={`drawer-wrap left ${open ? "open" : ""}`} aria-hidden={!open}>
      <button type="button" className="overlay-scrim" aria-label="Close menu" onClick={onClose} tabIndex={open ? 0 : -1} />
      <aside className="drawer menu" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="drawer-head">
          <Logo height={16} />
          <button type="button" className="icon-btn" aria-label="Close menu" onClick={onClose} tabIndex={open ? 0 : -1}><I.close /></button>
        </div>
        <nav className="menu-nav" aria-label="Mobile">
          {NAV.map((n, i) => <Link key={n.label} to={n.to} style={{ transitionDelay: `${80 + i * 50}ms` }} tabIndex={open ? 0 : -1}>{n.label}</Link>)}
          <Link to="/wishlist" tabIndex={open ? 0 : -1}>Wishlist</Link>
        </nav>
        <div className="menu-cats">
          <span className="kicker">Categories</span>
          {CATEGORIES.map((c) => <Link key={c.id} to={`/shop?category=${c.id}`} tabIndex={open ? 0 : -1}>{c.label}</Link>)}
        </div>
        <p className="menu-foot">Delivery across Egypt · 3–7 days</p>
      </aside>
    </div>
  );
}

/* ---------------- Cart drawer ---------------- */
export function CartDrawer() {
  const { cart, cartOpen, setCartOpen, setQty, removeLine, subtotal, toast, addToCart, stock } = useStore();
  const navigate = useNavigate();
  const close = useCallback(() => setCartOpen(false), [setCartOpen]);
  useLockScroll(cartOpen);
  useEscape(cartOpen, close);
  const left = Math.max(0, FREE_DELIVERY_OVER - subtotal);
  const pct = Math.min(100, (subtotal / FREE_DELIVERY_OVER) * 100);
  const t = cartOpen ? 0 : -1;
  return (
    <div className={`drawer-wrap right ${cartOpen ? "open" : ""}`} aria-hidden={!cartOpen}>
      <button type="button" className="overlay-scrim" aria-label="Close cart" onClick={close} tabIndex={t} />
      <aside className="drawer cart" role="dialog" aria-modal="true" aria-label="Shopping cart">
        <div className="drawer-head">
          <h2 className="drawer-title">Your cart <span>({cart.reduce((n, l) => n + l.qty, 0)})</span></h2>
          <button type="button" className="icon-btn" aria-label="Close cart" onClick={close} tabIndex={t}><I.close /></button>
        </div>
        {cart.length === 0 ? (
          <div className="cart-empty">
            <I.bag width={40} height={40} />
            <p>Your cart is empty.<br />The look won't steal itself.</p>
            <button type="button" className="btn btn-light" onClick={() => { close(); navigate("/shop"); }} tabIndex={t}>Shop the collection</button>
          </div>
        ) : (
          <>
            <div className="ship-meter">
              <p>{left > 0 ? <>Add <strong>{egp(left)}</strong> for free delivery</> : <>You've unlocked <strong>free delivery</strong></>}</p>
              <div className="meter"><span style={{ width: `${pct}%` }} /></div>
            </div>
            <ul className="cart-lines">
              {cart.map((l) => {
                const p = findProduct(l.slug)!;
                const max = stock[l.slug]?.[l.size] ?? 0;
                return (
                  <li key={`${l.slug}-${l.size}`} className="cart-line">
                    <Link to={`/product/${p.slug}`} onClick={close} className="cl-img" tabIndex={t}><ProductVisual p={p} /></Link>
                    <div className="cl-info">
                      <Link to={`/product/${p.slug}`} onClick={close} className="cl-name" tabIndex={t}>{p.name}</Link>
                      <span className="cl-meta">{p.piece} · Size {l.size}</span>
                      {p.kind === "demo" && <span className="cl-demo">Demo item</span>}
                      <div className="cl-row">
                        <Qty value={l.qty} max={max} label={`Quantity of ${p.name}`} onChange={(n) => setQty(l.slug, l.size, n)} />
                        <span className="cl-price">{egp(p.price * l.qty)}</span>
                      </div>
                      {l.qty >= max && <span className="cl-max">Only {max} in stock</span>}
                      <button type="button" className="cl-remove" tabIndex={t} onClick={() => { removeLine(l.slug, l.size); toast(`${p.name} removed`, { label: "Undo", run: () => addToCart(l.slug, l.size, l.qty) }); }}>Remove</button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="cart-foot">
              <div className="cart-sum"><span>Subtotal</span><strong>{egp(subtotal)}</strong></div>
              <p className="cart-note">Delivery calculated at checkout · 3–7 days across Egypt</p>
              <button type="button" className="btn btn-gold btn-block" tabIndex={t} onClick={() => { close(); navigate("/checkout"); }}>
                <I.lock width={16} /> Secure checkout
              </button>
              <button type="button" className="btn btn-ghost btn-block" tabIndex={t} onClick={close}>Continue shopping</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/* ---------------- Newsletter (demo: nothing stored or sent) ---------------- */
export function Newsletter({ compact }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "error" | "done">("idle");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setState("error"); return; }
    setState("done");
    setEmail("");
  };
  return (
    <div className={`newsletter ${compact ? "compact" : ""}`}>
      {state === "done" ? (
        <p className="nl-done" role="status"><I.check width={18} /> You're on the list. <em>(Demo: the address was not stored or sent.)</em></p>
      ) : (
        <form onSubmit={submit} noValidate>
          <label htmlFor={compact ? "nl-f" : "nl-m"} className="sr-only">Email address</label>
          <input id={compact ? "nl-f" : "nl-m"} type="email" placeholder="Your email address" value={email} onChange={(e) => { setEmail(e.target.value); setState("idle"); }} aria-invalid={state === "error"} aria-describedby="nl-hint" />
          <button type="submit" className="btn btn-light">Join the crew</button>
        </form>
      )}
      <p id="nl-hint" className={`nl-hint ${state === "error" ? "err" : ""}`}>
        {state === "error" ? "Please enter a valid email address." : "Demo mode — no email is collected. First access to every mission."}
      </p>
    </div>
  );
}

/* ---------------- Footer ---------------- */
export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-top">
        <div className="footer-brand">
          <img src="./brand/lupin-logo.png" alt="LUPIN WEAR" className="footer-logo" />
          <p className="footer-tag">Steal the Look.</p>
          <p className="muted">Curated luxury streetwear, released in limited missions. Delivered across Egypt.</p>
        </div>
        <div className="footer-cols">
          <div>
            <h3>Shop</h3>
            {CATEGORIES.map((c) => <Link key={c.id} to={`/shop?category=${c.id}`}>{c.label}</Link>)}
            <Link to="/shop?sort=new">New in</Link>
          </div>
          <div>
            <h3>The House</h3>
            <Link to="/heist">The Heist</Link>
            <Link to="/story">Our story</Link>
            <Link to="/wishlist">Wishlist</Link>
          </div>
          <div>
            <h3>Service</h3>
            <Link to="/policies#delivery">Delivery</Link>
            <Link to="/policies#returns">Returns & exchanges</Link>
            <Link to="/policies#payment">Payment</Link>
            <Link to="/policies#demo">About this demo</Link>
          </div>
        </div>
        <div className="footer-nl">
          <h3>Join the crew</h3>
          <Newsletter compact />
        </div>
      </div>
      <div className="footer-pay" aria-label="Payment and delivery">
        <span><I.truck width={16} /> Nationwide delivery · 3–7 days</span>
        <span><I.card width={16} /> Payments by Paymob (demo)</span>
        <span><I.shield width={16} /> Returns per Egyptian consumer law</span>
      </div>
      <div className="footer-legal">
        <p>© 2026 LUPIN WEAR · Demo build for presentation — no real transactions.</p>
        <p>All heist scenarios are fictional, staged advertising. LUPIN. is an independent reseller, not affiliated with or endorsed by Bershka, Inditex, LC Waikiki, H&M or Team 365. Pieces marked “Demo item” are illustrated samples, not real products.</p>
      </div>
    </footer>
  );
}
