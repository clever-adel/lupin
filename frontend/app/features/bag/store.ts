import { useSyncExternalStore } from "react";

/**
 * Guest bag and favourites, kept in this browser only. They hold ids and quantities, never prices:
 * every price and stock figure shown to the shopper comes from the server.
 */
export interface BagLine {
  variantId: number;
  quantity: number;
}

interface State {
  bag: BagLine[];
  favourites: string[];
}

const KEY = "lupin.bag.v1";
const EMPTY: State = { bag: [], favourites: [] };
export const MAX_LINE_QUANTITY = 10;

let state: State = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function sanitize(raw: unknown): State {
  const value = (raw ?? {}) as Partial<State>;
  const bag = Array.isArray(value.bag)
    ? value.bag
        .filter((l) => Number.isInteger(l?.variantId) && Number.isInteger(l?.quantity) && l.quantity > 0)
        .map((l) => ({ variantId: l.variantId, quantity: Math.min(l.quantity, MAX_LINE_QUANTITY) }))
    : [];
  const favourites = Array.isArray(value.favourites)
    ? value.favourites.filter((s) => typeof s === "string").slice(0, 200)
    : [];
  return { bag, favourites };
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    state = sanitize(JSON.parse(window.localStorage.getItem(KEY) ?? "null"));
  } catch {
    state = EMPTY;
  }
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    try {
      state = sanitize(JSON.parse(event.newValue ?? "null"));
    } catch {
      state = EMPTY;
    }
    listeners.forEach((l) => l());
  });
}

function commit(next: State) {
  state = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: the bag still works for this page view.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): State {
  load();
  return state;
}

/** Server render and first client render both see an empty bag, so hydration matches. */
export function useBagState(): State {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export const bagActions = {
  add(variantId: number, quantity: number) {
    const current = snapshot();
    const existing = current.bag.find((l) => l.variantId === variantId);
    const total = Math.min((existing?.quantity ?? 0) + quantity, MAX_LINE_QUANTITY);
    const bag = existing
      ? current.bag.map((l) => (l.variantId === variantId ? { ...l, quantity: total } : l))
      : [...current.bag, { variantId, quantity: total }];
    commit({ ...current, bag });
  },
  setQuantity(variantId: number, quantity: number) {
    const current = snapshot();
    const clamped = Math.max(1, Math.min(quantity, MAX_LINE_QUANTITY));
    commit({ ...current, bag: current.bag.map((l) => (l.variantId === variantId ? { ...l, quantity: clamped } : l)) });
  },
  remove(variantId: number) {
    const current = snapshot();
    commit({ ...current, bag: current.bag.filter((l) => l.variantId !== variantId) });
  },
  /** Empties the bag lines (after they moved to the account's bag). Favourites stay. */
  clearBag() {
    commit({ ...snapshot(), bag: [] });
  },
  toggleFavourite(slug: string) {
    const current = snapshot();
    const favourites = current.favourites.includes(slug)
      ? current.favourites.filter((s) => s !== slug)
      : [...current.favourites, slug];
    commit({ ...current, favourites });
  },
  /** Test hook. */
  reset() {
    state = EMPTY;
    loaded = true;
    listeners.forEach((l) => l());
  },
};

export function bagCount(bag: BagLine[]): number {
  return bag.reduce((sum, line) => sum + line.quantity, 0);
}
