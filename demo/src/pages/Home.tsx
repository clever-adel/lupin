import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { MISSIONS, PRODUCTS, findProduct } from "../data";
import { Newsletter } from "../components/layout";
import { I, ProductCard, Reveal, SectionHead } from "../components/ui";
import { StoryBlock } from "./Story";

const byNew = [...PRODUCTS].sort((a, b) => b.added.localeCompare(a.added));
const best = PRODUCTS.filter((p) => p.bestSeller).sort((a, b) => b.sold - a.sold);

export default function Home() {
  const hero = useRef<HTMLElement>(null);
  // Subtle parallax on the hero frames; skipped for reduced motion.
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => hero.current?.style.setProperty("--py", String(Math.min(window.scrollY, 900))));
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => { window.removeEventListener("scroll", on); cancelAnimationFrame(raf); };
  }, []);

  const alibi = findProduct("the-alibi")!;
  const key = findProduct("the-master-key")!;
  const brooklyn = findProduct("the-brooklyn-job")!;

  return (
    <>
      {/* ---------- Hero ---------- */}
      <section className="hero" ref={hero} aria-label="LUPIN WEAR">
        <div className="hero-light" aria-hidden />
        <div className="hero-grain" aria-hidden />
        <div className="hero-frames" aria-hidden>
          <figure className="frame f1"><img src={key.images[2]} alt="" /><figcaption>Exhibit B · The Master Key</figcaption></figure>
          <figure className="frame f2"><img src={alibi.images[1]} alt="" /><figcaption>Exhibit A · The Alibi</figcaption></figure>
          <figure className="frame f3"><img src={brooklyn.images[1]} alt="" /><figcaption>Exhibit C · The Brooklyn Job</figcaption></figure>
        </div>
        <div className="hero-copy">
          <span className="hero-kicker">Mission 001 · The First Drop</span>
          <h1 className="hero-logo"><img src="./brand/lupin-logo.png" alt="LUPIN WEAR" /></h1>
          <p className="hero-tag">The look is the only thing <em>worth stealing.</em></p>
          <p className="hero-sub">Luxury streetwear for the gentleman thief. Limited pieces, released in missions, delivered across Egypt.</p>
          <div className="hero-cta">
            <Link to="/shop" className="btn btn-light">Shop now</Link>
            <Link to="/heist" className="btn btn-outline-light">Enter the Heist</Link>
          </div>
        </div>
        <div className="hero-scroll" aria-hidden><span /></div>
      </section>

      {/* ---------- Marquee ---------- */}
      <div className="marquee" aria-label="Store promises">
        <div className="marquee-track">
          {Array.from({ length: 2 }).map((_, k) => (
            <span key={k} aria-hidden={k === 1}>
              Nationwide delivery across Egypt <i>✦</i> Delivered in 3–7 days <i>✦</i> Secure payment by Paymob <i>✦</i> Free delivery over EGP 2,000 <i>✦</i> Limited missions, limited pieces <i>✦</i>{" "}
            </span>
          ))}
        </div>
      </div>

      {/* ---------- Featured collections ---------- */}
      <section className="section wrap">
        <SectionHead kicker="Featured collections" title={<>Choose your <em>target</em></>} />
        <div className="collections">
          <Reveal className="coll coll-a">
            <Link to="/shop?mission=1">
              <img src={alibi.images[1]} alt="" loading="lazy" />
              <div className="coll-copy"><span className="kicker">Mission 001</span><h3>The First Drop</h3><span className="link-arrow">Shop the mission <I.arrow width={16} /></span></div>
            </Link>
          </Reveal>
          <Reveal className="coll coll-b" delay={100}>
            <Link to="/shop?category=outerwear">
              <img src={findProduct("the-getaway-driver")!.images[0]} alt="" loading="lazy" />
              <div className="coll-copy"><span className="kicker">Collection</span><h3>Outerwear</h3><span className="link-arrow">Layers for the getaway <I.arrow width={16} /></span></div>
            </Link>
          </Reveal>
          <Reveal className="coll coll-c" delay={200}>
            <Link to="/shop?category=hoodies">
              <img src={brooklyn.images[0]} alt="" loading="lazy" />
              <div className="coll-copy"><span className="kicker">Collection</span><h3>Hoodies</h3><span className="link-arrow">Heavy fleece <I.arrow width={16} /></span></div>
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ---------- New arrivals ---------- */}
      <section className="section wrap">
        <SectionHead kicker="Just landed" title={<>New <em>arrivals</em></>} action={<Link to="/shop?sort=new" className="link-arrow">View all <I.arrow width={16} /></Link>} />
        <div className="rail" role="list">
          {byNew.slice(0, 8).map((p, i) => <Reveal key={p.id} delay={i * 60} className="rail-item"><ProductCard p={p} /></Reveal>)}
        </div>
      </section>

      {/* ---------- Editorial campaign ---------- */}
      <section className="editorial" aria-label="Campaign">
        <div className="wrap editorial-in">
          <Reveal className="ed-copy">
            <span className="kicker gold">The campaign · Case file 001</span>
            <h2 className="h2 light">Three targets.<br /><em>One mission.</em></h2>
            <p>Shot like a dossier, told like a film. Mission 001 follows a faceless gentleman through a single night — the blueprint, the rail, the vault, the getaway. The pieces are real; the heist is pure fiction.</p>
            <Link to="/heist" className="btn btn-outline-light">Open the case file</Link>
            <p className="fiction-note">Fictional, staged advertising campaign. No theft is depicted or encouraged.</p>
          </Reveal>
          <div className="ed-stack">
            {["m001-teaser", "m001-the-alibi", "m001-the-brooklyn-job"].map((f, i) => (
              <Reveal key={f} delay={i * 120} className={`ed-card e${i}`}><img src={`./campaign/${f}.webp`} alt={`Mission 001 campaign artwork ${i + 1}`} loading="lazy" /></Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Best sellers ---------- */}
      <section className="section wrap">
        <SectionHead kicker="Most wanted" title={<>Best <em>sellers</em></>} action={<Link to="/shop?sort=best" className="link-arrow">Shop best sellers <I.arrow width={16} /></Link>} />
        <div className="grid">
          {best.slice(0, 4).map((p, i) => <Reveal key={p.id} delay={i * 70}><ProductCard p={p} /></Reveal>)}
        </div>
      </section>

      {/* ---------- Heist teaser ---------- */}
      <section className="section wrap">
        <SectionHead kicker="The Lupin experience" title={<>The <em>Heist</em></>} action={<Link to="/heist" className="link-arrow">The full story <I.arrow width={16} /></Link>} />
        <div className="missions-mini">
          {MISSIONS.map((m, i) => (
            <Reveal key={m.code} delay={i * 100} className={`mm ${m.n === 3 ? "locked" : ""}`}>
              <Link to={`/heist#mission-${m.code}`}>
                <span className="mm-code">Mission {m.code}</span>
                <h3>{m.title}</h3>
                <p>{m.lede}</p>
                <span className={`mm-status s${m.n}`}>{m.n === 3 && <I.lock width={14} />} {m.status}</span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- Story ---------- */}
      <StoryBlock />

      {/* ---------- Newsletter ---------- */}
      <section className="nl-band">
        <Reveal className="wrap nl-in">
          <span className="kicker gold">The inner circle</span>
          <h2 className="h2 light">Get the coordinates <em>first.</em></h2>
          <p>Mission dates, early access and restocks — before anyone else.</p>
          <Newsletter />
        </Reveal>
      </section>
    </>
  );
}
