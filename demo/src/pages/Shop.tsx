import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CATEGORIES, MISSIONS, PRODUCTS, SIZE_ORDER, categoryLabel, discountPct, type Category } from "../data";
import { searchProducts } from "../components/layout";
import { I, ProductCard, Reveal, useEscape, useLockScroll } from "../components/ui";
import { useStore } from "../store";

const SORTS = [
  { id: "featured", label: "Featured" },
  { id: "new", label: "Newest" },
  { id: "best", label: "Best selling" },
  { id: "price-asc", label: "Price: low to high" },
  { id: "price-desc", label: "Price: high to low" },
  { id: "discount", label: "Biggest discount" },
];
const PRICE_MAX = Math.ceil(Math.max(...PRODUCTS.map((p) => p.price)) / 250) * 250;
const ALL_SIZES = SIZE_ORDER.filter((s) => PRODUCTS.some((p) => p.sizes.includes(s)));

export default function Shop() {
  const [params, setParams] = useSearchParams();
  const { stock, inStock } = useStore();
  const [filtersOpen, setFiltersOpen] = useState(false);
  useLockScroll(filtersOpen);
  useEscape(filtersOpen, () => setFiltersOpen(false));

  const q = params.get("q") ?? "";
  const cats = (params.get("category") ?? "").split(",").filter(Boolean) as Category[];
  const sizes = (params.get("size") ?? "").split(",").filter(Boolean);
  const max = Number(params.get("max") ?? PRICE_MAX);
  const min = Number(params.get("min") ?? 0);
  const inStockOnly = params.get("stock") === "1";
  const mission = params.get("mission");
  const sort = params.get("sort") ?? "featured";

  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v === null || v === "") n.delete(k); else n.set(k, v);
    setParams(n, { replace: true });
  };
  const toggleList = (k: string, list: string[], v: string) => set(k, (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]).join(","));

  const results = useMemo(() => {
    let r = q ? searchProducts(q) : [...PRODUCTS];
    if (cats.length) r = r.filter((p) => cats.includes(p.category));
    if (sizes.length) r = r.filter((p) => sizes.some((s) => (stock[p.slug]?.[s] ?? 0) > 0));
    r = r.filter((p) => p.price >= min && p.price <= max);
    if (inStockOnly) r = r.filter(inStock);
    if (mission) r = r.filter((p) => String(p.mission) === mission);
    switch (sort) {
      case "new": r.sort((a, b) => b.added.localeCompare(a.added)); break;
      case "best": r.sort((a, b) => b.sold - a.sold); break;
      case "price-asc": r.sort((a, b) => a.price - b.price); break;
      case "price-desc": r.sort((a, b) => b.price - a.price); break;
      case "discount": r.sort((a, b) => discountPct(b) - discountPct(a)); break;
      default: r.sort((a, b) => Number(b.kind === "real") - Number(a.kind === "real") || b.sold - a.sold);
    }
    // Sold-out pieces always sink to the end.
    return r.sort((a, b) => Number(inStock(b)) - Number(inStock(a)));
  }, [q, cats.join(), sizes.join(), min, max, inStockOnly, mission, sort, stock]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = cats.length + sizes.length + (max < PRICE_MAX || min > 0 ? 1 : 0) + (inStockOnly ? 1 : 0) + (mission ? 1 : 0);
  const missionTitle = mission ? MISSIONS.find((m) => String(m.n) === mission) : null;
  const title = q ? <>Results for “{q}”</> : missionTitle ? <>Mission {missionTitle.code}: <em>{missionTitle.title}</em></> : cats.length === 1 ? <>{categoryLabel(cats[0])}</> : <>The <em>collection</em></>;

  const filters = (
    <div className="filters">
      <fieldset>
        <legend>Category</legend>
        {CATEGORIES.map((c) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={cats.includes(c.id)} onChange={() => toggleList("category", cats, c.id)} />
            <span>{c.label}</span>
            <small>{PRODUCTS.filter((p) => p.category === c.id).length}</small>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Size <small>in stock</small></legend>
        <div className="size-chips">
          {ALL_SIZES.map((s) => (
            <button type="button" key={s} className={`size-chip ${sizes.includes(s) ? "on" : ""}`} aria-pressed={sizes.includes(s)} onClick={() => toggleList("size", sizes, s)}>{s}</button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Price</legend>
        <div className="price-range">
          <label>Min <span>EGP</span><input type="number" inputMode="numeric" min={0} max={max} step={50} value={min} onChange={(e) => set("min", e.target.value === "0" ? null : e.target.value)} /></label>
          <label>Max <span>EGP</span><input type="number" inputMode="numeric" min={min} max={PRICE_MAX} step={50} value={max} onChange={(e) => set("max", Number(e.target.value) >= PRICE_MAX ? null : e.target.value)} /></label>
        </div>
        <input type="range" className="range" min={0} max={PRICE_MAX} step={50} value={max} aria-label="Maximum price" onChange={(e) => set("max", Number(e.target.value) >= PRICE_MAX ? null : e.target.value)} />
        <div className="chips">
          {[[0, 700], [700, 1500], [1500, PRICE_MAX]].map(([a, b]) => (
            <button type="button" key={a} className={`chip ${min === a && max === b ? "on" : ""}`} onClick={() => { const n = new URLSearchParams(params); a ? n.set("min", String(a)) : n.delete("min"); b < PRICE_MAX ? n.set("max", String(b)) : n.delete("max"); setParams(n, { replace: true }); }}>
              {b >= PRICE_MAX ? `${a.toLocaleString()}+` : a === 0 ? `Under ${b.toLocaleString()}` : `${a.toLocaleString()}–${b.toLocaleString()}`}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Availability</legend>
        <label className="check toggle">
          <input type="checkbox" checked={inStockOnly} onChange={(e) => set("stock", e.target.checked ? "1" : null)} />
          <span>In stock only</span>
        </label>
      </fieldset>
      <fieldset>
        <legend>The Heist</legend>
        {MISSIONS.slice(0, 2).map((m) => (
          <label key={m.code} className="check">
            <input type="radio" name="mission" checked={mission === String(m.n)} onChange={() => set("mission", String(m.n))} />
            <span>Mission {m.code} · {m.title}</span>
          </label>
        ))}
        {mission && <button type="button" className="text-btn" onClick={() => set("mission", null)}>Any mission</button>}
      </fieldset>
    </div>
  );

  const clearAll = () => setParams(new URLSearchParams(sort !== "featured" ? { sort } : {}), { replace: true });

  return (
    <div className="page shop wrap">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><span aria-current="page">Shop</span></nav>
      <header className="shop-head">
        <h1 className="h1">{title}</h1>
        <p className="muted">{results.length} {results.length === 1 ? "piece" : "pieces"} · Real pieces shown with actual product photos; demo items are illustrated samples.</p>
      </header>

      <div className="cat-tabs" role="list">
        <button type="button" className={`cat-tab ${cats.length === 0 ? "on" : ""}`} onClick={() => set("category", null)}>All</button>
        {CATEGORIES.map((c) => (
          <button type="button" key={c.id} className={`cat-tab ${cats.length === 1 && cats[0] === c.id ? "on" : ""}`} onClick={() => set("category", c.id)}>{c.label}</button>
        ))}
      </div>

      <div className="toolbar">
        <button type="button" className="btn btn-ghost only-mobile-flex" onClick={() => setFiltersOpen(true)}><I.filter width={16} /> Filters{active > 0 && ` (${active})`}</button>
        <div className="search-inline">
          <I.search width={16} />
          <input type="search" placeholder="Search the collection" value={q} onChange={(e) => set("q", e.target.value)} aria-label="Search the collection" />
        </div>
        <label className="sort">
          <span>Sort</span>
          <select value={sort} onChange={(e) => set("sort", e.target.value === "featured" ? null : e.target.value)}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {active > 0 && (
        <div className="active-filters">
          {cats.map((c) => <button type="button" key={c} className="chip on" onClick={() => toggleList("category", cats, c)}>{categoryLabel(c)} <I.close width={12} /></button>)}
          {sizes.map((s) => <button type="button" key={s} className="chip on" onClick={() => toggleList("size", sizes, s)}>Size {s} <I.close width={12} /></button>)}
          {(max < PRICE_MAX || min > 0) && <button type="button" className="chip on" onClick={() => { const n = new URLSearchParams(params); n.delete("min"); n.delete("max"); setParams(n, { replace: true }); }}>EGP {min.toLocaleString()}–{max.toLocaleString()} <I.close width={12} /></button>}
          {inStockOnly && <button type="button" className="chip on" onClick={() => set("stock", null)}>In stock <I.close width={12} /></button>}
          {mission && <button type="button" className="chip on" onClick={() => set("mission", null)}>Mission 00{mission} <I.close width={12} /></button>}
          <button type="button" className="text-btn" onClick={clearAll}>Clear all</button>
        </div>
      )}

      <div className="shop-body">
        <aside className="shop-side only-desktop" aria-label="Filters">{filters}</aside>
        <div className="shop-results">
          {results.length === 0 ? (
            <div className="empty">
              <h2 className="h3">No pieces match.</h2>
              <p className="muted">Try removing a filter or searching for something else.</p>
              <button type="button" className="btn btn-dark" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters and search</button>
            </div>
          ) : (
            <div className="grid grid-3">
              {results.map((p, i) => <Reveal key={p.id} delay={(i % 3) * 60}><ProductCard p={p} /></Reveal>)}
            </div>
          )}
        </div>
      </div>

      <div className={`drawer-wrap left ${filtersOpen ? "open" : ""}`} aria-hidden={!filtersOpen}>
        <button type="button" className="overlay-scrim" aria-label="Close filters" onClick={() => setFiltersOpen(false)} tabIndex={filtersOpen ? 0 : -1} />
        <aside className="drawer filter-drawer" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="drawer-head"><h2 className="drawer-title">Filters</h2><button type="button" className="icon-btn" aria-label="Close filters" onClick={() => setFiltersOpen(false)}><I.close /></button></div>
          <div className="drawer-scroll">{filtersOpen && filters}</div>
          <div className="drawer-actions">
            <button type="button" className="btn btn-ghost" onClick={clearAll}>Clear</button>
            <button type="button" className="btn btn-dark" onClick={() => setFiltersOpen(false)}>Show {results.length}</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
