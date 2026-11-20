import { Link } from "react-router-dom";
import { findProduct } from "../data";
import { I, Reveal } from "../components/ui";

export function StoryBlock() {
  const alibi = findProduct("the-alibi")!;
  return (
    <section className="story wrap" aria-labelledby="story-h">
      <Reveal className="story-img">
        <img src={alibi.images[3]} alt="The Alibi hoodie, back view" loading="lazy" />
        <span className="story-cap">The Alibi · back print</span>
      </Reveal>
      <Reveal className="story-copy" delay={120}>
        <span className="kicker">Our story</span>
        <h2 id="story-h" className="h2">A gentleman never <em>takes.</em><br />He selects.</h2>
        <p>LUPIN WEAR was born from one idea: style is the only thing worth stealing. We hunt down the strongest streetwear from original makers, check every piece by hand, and release it in small, numbered missions.</p>
        <p>Every piece gets an operation name. Every drop gets a story. And every order arrives in the black bag with the gold seal — anywhere in Egypt.</p>
        <div className="story-stats">
          <div><strong>100%</strong><span>Original, legally sourced pieces</span></div>
          <div><strong>27</strong><span>Governorates we deliver to</span></div>
          <div><strong>3–7</strong><span>Days to your door</span></div>
        </div>
        <Link to="/heist" className="link-arrow">Discover The Heist <I.arrow width={16} /></Link>
      </Reveal>
    </section>
  );
}

export default function Story() {
  return (
    <div className="page">
      <section className="page-hero dark">
        <div className="wrap">
          <span className="kicker gold">The house of LUPIN</span>
          <h1 className="h1 light">Steal the <em>Look.</em></h1>
          <p className="lead light">Luxury streetwear × the mysterious gentleman thief × premium fashion.</p>
        </div>
      </section>
      <StoryBlock />
      <section className="wrap values">
        {[
          ["Curated, not mass-made", "Only the pieces worth the hunt. Small quantities, chosen one by one."],
          ["Honest by design", "Real photos of real pieces. Real prices. The heist is fiction — the quality is not."],
          ["Delivered with ceremony", "Black bag, gold seal, a note that reads “Mission complete.”"],
        ].map(([t, d], i) => (
          <Reveal key={t} delay={i * 90} className="value"><span className="value-n">0{i + 1}</span><h3>{t}</h3><p>{d}</p></Reveal>
        ))}
      </section>
    </div>
  );
}
