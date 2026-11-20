import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DELIVERY_FEE, FREE_DELIVERY_OVER, PRODUCTS, findProduct, type Product } from "./data";

// Demo state. Cart, wishlist, stock and demo orders are kept in this browser only (localStorage),
// so a presenter can refresh without losing the scene, and "Reset demo" puts everything back.
// No personal details are ever stored: checkout details live in component memory and vanish.

export interface CartLine { slug: string; size: string; qty: number }
export interface DemoOrder { ref: string; total: number; items: number; at: string; method: string }

interface State {
  cart: CartLine[];
  wishlist: string[];
  stock: Record<string, Record<string, number>>; // slug -> size -> qty
  orders: DemoOrder[];
}

const KEY = "lupin-demo-v1";

const initialStock = () => Object.fromEntries(PRODUCTS.map((p) => [p.slug, { ...p.stock }]));
const initialState = (): State => ({ cart: [], wishlist: [], stock: initialStock(), orders: [] });

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialState();
    const s = JSON.parse(raw) as State;
    // Drop anything that no longer matches the catalogue.
    return {
      cart: (s.cart ?? []).filter((l) => findProduct(l.slug)),
      wishlist: (s.wishlist ?? []).filter((w) => findProduct(w)),
      stock: { ...initialStock(), ...(s.stock ?? {}) },
      orders: s.orders ?? [],
    };
  } catch {
    return initialState();
  }
}

export interface Toast { id: number; text: string; action?: { label: string; run: () => void } }

interface Ctx extends State {
  available: (slug: string, size: string) => number; // stock left after what is already in the cart
  inStock: (p: Product) => boolean;
  addToCart: (slug: string, size: string, qty: number) => boolean;
  setQty: (slug: string, size: string, qty: number) => void;
  removeLine: (slug: string, size: string) => void;
  toggleWish: (slug: string) => void;
  cartCount: number;
  subtotal: number;
  delivery: number;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
  placeOrder: (method: string) => DemoOrder;
  reset: () => void;
  toasts: Toast[];
  toast: (text: string, action?: Toast["action"]) => void;
}

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load);
  const [cartOpen, setCartOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const tid = useRef(0);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: demo still works */ }
  }, [state]);

  const toast = useCallback((text: string, action?: Toast["action"]) => {
    const id = ++tid.current;
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const value = useMemo<Ctx>(() => {
    const stockOf = (slug: string, size: string) => state.stock[slug]?.[size] ?? 0;
    const inCart = (slug: string, size: string) => state.cart.find((l) => l.slug === slug && l.size === size)?.qty ?? 0;
    const subtotal = state.cart.reduce((s, l) => s + (findProduct(l.slug)?.price ?? 0) * l.qty, 0);
    return {
      ...state,
      available: (slug, size) => stockOf(slug, size) - inCart(slug, size),
      inStock: (p) => p.sizes.some((s) => stockOf(p.slug, s) > 0),
      addToCart: (slug, size, qty) => {
        const left = stockOf(slug, size) - inCart(slug, size);
        if (left <= 0) return false;
        const add = Math.min(qty, left);
        setState((s) => {
          const has = s.cart.find((l) => l.slug === slug && l.size === size);
          const cart = has
            ? s.cart.map((l) => (l === has ? { ...l, qty: l.qty + add } : l))
            : [...s.cart, { slug, size, qty: add }];
          return { ...s, cart };
        });
        return true;
      },
      setQty: (slug, size, qty) =>
        setState((s) => ({
          ...s,
          cart: s.cart
            .map((l) => (l.slug === slug && l.size === size ? { ...l, qty: Math.max(0, Math.min(qty, stockOf(slug, size))) } : l))
            .filter((l) => l.qty > 0),
        })),
      removeLine: (slug, size) => setState((s) => ({ ...s, cart: s.cart.filter((l) => !(l.slug === slug && l.size === size)) })),
      toggleWish: (slug) =>
        setState((s) => ({ ...s, wishlist: s.wishlist.includes(slug) ? s.wishlist.filter((w) => w !== slug) : [...s.wishlist, slug] })),
      cartCount: state.cart.reduce((n, l) => n + l.qty, 0),
      subtotal,
      delivery: subtotal === 0 || subtotal >= FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE,
      cartOpen,
      setCartOpen,
      placeOrder: (method) => {
        const total = subtotal + (subtotal >= FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE);
        const order: DemoOrder = {
          ref: `LW-DEMO-${String(Math.floor(10000 + Math.random() * 89999))}`,
          total,
          items: state.cart.reduce((n, l) => n + l.qty, 0),
          at: new Date().toISOString(),
          method,
        };
        setState((s) => {
          const stock = structuredClone(s.stock);
          for (const l of s.cart) stock[l.slug][l.size] = Math.max(0, (stock[l.slug][l.size] ?? 0) - l.qty);
          return { ...s, stock, cart: [], orders: [order, ...s.orders] };
        });
        return order;
      },
      reset: () => {
        try { localStorage.removeItem(KEY); } catch { /* ignore */ }
        setState(initialState());
        setCartOpen(false);
      },
      toasts,
      toast,
    };
  }, [state, cartOpen, toasts, toast]);

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("useStore outside provider");
  return c;
}
