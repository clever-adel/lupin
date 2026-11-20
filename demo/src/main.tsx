import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes, useLocation } from "react-router-dom";
import "@fontsource/michroma/400.css";
import "@fontsource-variable/archivo/wght.css";
import "@fontsource/cormorant-garamond/400-italic.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "./styles.css";
import { StoreProvider } from "./store";
import { CartDrawer, DemoBar, Footer, Header } from "./components/layout";
import { Toasts } from "./components/ui";
import Home from "./pages/Home";
import Shop from "./pages/Shop";
import ProductPage from "./pages/Product";
import Checkout from "./pages/Checkout";
import Heist from "./pages/Heist";
import Story from "./pages/Story";
import Policies from "./pages/Policies";
import Wishlist from "./pages/Wishlist";
import NotFound from "./pages/NotFound";

const TITLES: Record<string, string> = {
  "/": "LUPIN WEAR — Steal the Look",
  "/shop": "Shop — LUPIN WEAR",
  "/heist": "The Heist — LUPIN WEAR",
  "/story": "Our Story — LUPIN WEAR",
  "/policies": "Service & Policies — LUPIN WEAR",
  "/wishlist": "Wishlist — LUPIN WEAR",
  "/checkout": "Checkout — LUPIN WEAR",
};

function Shell() {
  const loc = useLocation();
  useEffect(() => {
    if (!loc.hash) window.scrollTo(0, 0);
    document.title = `${TITLES[loc.pathname] ?? "LUPIN WEAR"} (Demo)`;
  }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <a href="#main" className="skip" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <DemoBar />
      <Header />
      <main id="main" tabIndex={-1} key={loc.pathname} className="route">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/product/:slug" element={<ProductPage />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/heist" element={<Heist />} />
          <Route path="/story" element={<Story />} />
          <Route path="/policies" element={<Policies />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
      <CartDrawer />
      <Toasts />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </HashRouter>
  </StrictMode>,
);
