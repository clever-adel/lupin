import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { MISSIONS, PRODUCTS } from "../data";
import { I, ProductCard, Reveal } from "../components/ui";

const SCENES = [
  { n: "01", t: "The Blueprint", d: "Midnight. Gloved hands spread a floor plan across a walnut desk. A brass key, a torn LUPIN. tag, a cold coffee." },
  { n: "02", t: "The Security Room", d: "A wall of monitors. One screen frames a single hanger under a spotlight. The target is chosen." },
  { n: "03", t: "The Rail", d: "An empty boutique after hours. One hanger lit. A gloved hand enters the frame." },
  { n: "04", t: "The Vault", d: "A steel door, half open. Folded pieces on lit shelves and a black bag with a gold seal." },
  { n: "05", t: "The Getaway", d: "Wet street, idling car. He walks away — and the print on his back says everything." },
  { n: "06", t: "Mission Complete", d: "Dawn. A LUPIN. bag on a doorstep and a handwritten card: Mission complete." },
];

export default function Heist() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" }), 80);
  }, [hash]);
  const [joined, setJoined] = useState(false);
  const [email, setEmail] = useState("");
  const [err, setErr] = useState(false);
  const join = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setErr(true); return; }
    setJoined(true);
  };

  return (
    <div className="heist">
      <section className="heist-hero">
        <div className="hero-light" aria-hidden />
        <div className="hero-grain" aria-hidden />
        <div className="heist-hero-in">
          <span className="stamp">Fictional campaign</span>
          <span className="hero-kicker">The LUPIN experience</span>
          <h1 className="heist-title">THE <em>HEIST</em></h1>
          <p className="hero-sub">Every drop is a mission. Every piece has an operation name. The only thing ever stolen is the spotlight.</p>
          <div className="hero-cta">
            <a href="#mission-001" className="btn btn-light" onClick={(e) => { e.preventDefault(); document.getElementById("mission-001")?.scrollIntoView({ behavior: "smooth" }); }}>Begin the briefing</a>
          </div>
          <p className="fiction-note light">All theft scenarios are fictional, staged advertising. No real places, people or thefts are depicted. Every piece is original and legally sourced.</p>
        </div>
      </section>

      {MISSIONS.map((m, idx) => {
        const pieces = PRODUCTS.filter((p) => p.mission === m.n);
        const locked = m.n === 3;
        return (
          <section key={m.code} id={`mission-${m.code}`} className={`mission m${m.n} ${locked ? "locked" : ""}`} aria-labelledby={`mt-${m.code}`}>
            <div className="wrap mission-in">
              <Reveal className="mission-file">
                <div className={`dossier ${locked ? "blur" : ""}`}>
                  <img src={m.image} alt={locked ? "" : `Mission ${m.code} campaign artwork`} loading="lazy" />
                  {locked && <div className="dossier-lock"><I.lock width={28} /><span>Classified</span></div>}
                </div>
                <span className="file-tab">Case file · {m.code}</span>
              </Reveal>
              <Reveal className="mission-copy" delay={120}>
                <span className="mission-num" aria-hidden>{m.code}</span>
                <span className={`mm-status s${m.n}`}>{locked && <I.lock width={14} />} {m.status}</span>
                <h2 id={`mt-${m.code}`} className="h2 light">Mission {m.code}<br /><em>{m.title}</em></h2>
                <p className="lead light">{m.lede}</p>
                <p className="muted-light">{m.body}</p>
                {locked ? (
                  joined ? (
                    <p className="nl-done light" role="status"><I.check width={18} /> You're on the list for Mission 003. <em>(Demo: nothing was stored or sent.)</em></p>
                  ) : (
                    <form className="inline-form" onSubmit={join} noValidate>
                      <label htmlFor="m3-email" className="sr-only">Email address</label>
                      <input id="m3-email" type="email" placeholder="Your email for the coordinates" value={email} onChange={(e) => { setEmail(e.target.value); setErr(false); }} aria-invalid={err} />
                      <button type="submit" className="btn btn-gold">Notify me</button>
                      {err && <span className="field-err">Please enter a valid email.</span>}
                    </form>
                  )
                ) : (
                  <Link to={`/shop?mission=${m.n}`} className="btn btn-outline-light">Shop Mission {m.code} <I.arrow width={16} /></Link>
                )}
              </Reveal>
            </div>
            {!locked && pieces.length > 0 && (
              <div className="wrap mission-pieces">
                <span className="kicker gold">Operations in this mission</span>
                <div className="grid">{pieces.slice(0, 4).map((p, i) => <Reveal key={p.id} delay={i * 80}><ProductCard p={p} /></Reveal>)}</div>
              </div>
            )}
            {idx === 0 && (
              <div className="wrap scenes">
                <span className="kicker gold">The film · six scenes</span>
                <ol className="scene-list">
                  {SCENES.map((s, i) => (
                    <Reveal as="li" key={s.n} delay={i * 70} className="scene">
                      <span className="scene-n">{s.n}</span>
                      <h3>{s.t}</h3>
                      <p>{s.d}</p>
                    </Reveal>
                  ))}
                </ol>
                <p className="fiction-note light">Staged scenes for advertising. The gentleman thief is a fictional character.</p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
