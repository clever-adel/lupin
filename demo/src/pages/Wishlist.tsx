import { Link } from "react-router-dom";
import { findProduct } from "../data";
import { I, ProductCard } from "../components/ui";
import { useStore } from "../store";

export default function Wishlist() {
  const { wishlist, toggleWish } = useStore();
  const items = wishlist.map(findProduct).filter((p): p is NonNullable<typeof p> => !!p);
  return (
    <div className="page wrap">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><span aria-current="page">Wishlist</span></nav>
      <header className="shop-head">
        <h1 className="h1">Your <em>wishlist</em></h1>
        <p className="muted">{items.length} saved {items.length === 1 ? "piece" : "pieces"} · Kept in this browser only.</p>
      </header>
      {items.length === 0 ? (
        <div className="empty">
          <I.heart width={36} height={36} />
          <h2 className="h3">Nothing saved yet.</h2>
          <p className="muted">Tap the heart on any piece to keep it here.</p>
          <Link to="/shop" className="btn btn-dark">Explore the collection</Link>
        </div>
      ) : (
        <>
          <div className="grid">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          <button type="button" className="text-btn" onClick={() => items.forEach((p) => toggleWish(p.slug))}>Clear wishlist</button>
        </>
      )}
    </div>
  );
}
