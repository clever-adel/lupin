import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useMe } from "~/features/auth/session";
import { api, ApiError } from "~/lib/http";
import type { BagItem, Cart, VariantLine } from "~/lib/types";
import { bagActions, useBagState } from "./store";

export const CART_KEY = ["cart"] as const;
const MAX_LINES = 50;

type Change =
  | { type: "add"; variantId: number; quantity: number }
  | { type: "set"; variantId: number; quantity: number }
  | { type: "remove"; variantId: number };

/**
 * One bag for the whole storefront. Signed out: ids and quantities live in this browser and are priced
 * by the server on every view. Signed in: the bag lives in the account on the server.
 */
export function useBag() {
  const me = useMe();
  const signedIn = Boolean(me.data);
  const local = useBagState();
  const client = useQueryClient();
  const ids = local.bag.map((l) => l.variantId).sort((a, b) => a - b);

  const guest = useQuery({
    queryKey: ["bag-lines", ids],
    queryFn: () => api<VariantLine[]>("GET", `/api/v1/catalog/variants?ids=${ids.join(",")}`),
    enabled: !signedIn && ids.length > 0,
    staleTime: 15_000,
  });
  const server = useQuery({
    queryKey: CART_KEY,
    queryFn: () => api<Cart>("GET", "/api/v1/cart"),
    enabled: signedIn,
    staleTime: 15_000,
  });

  const change = useMutation({
    mutationFn: (c: Change) => {
      if (c.type === "add") {
        return api<Cart>("POST", "/api/v1/cart/merge", { items: [{ variantId: c.variantId, quantity: c.quantity }] });
      }
      if (c.type === "set") {
        return api<Cart>("PUT", `/api/v1/cart/items/${c.variantId}`, { quantity: c.quantity });
      }
      return api<Cart>("DELETE", `/api/v1/cart/items/${c.variantId}`);
    },
    onSuccess: (cart) => client.setQueryData(CART_KEY, cart),
    onError: () => client.invalidateQueries({ queryKey: CART_KEY }),
  });

  let items: BagItem[];
  if (signedIn) {
    items = server.data?.lines ?? [];
  } else {
    const live = new Map((guest.data ?? []).map((l) => [l.variantId, l]));
    items = guest.data
      ? local.bag.map((line): BagItem => {
          const v = live.get(line.variantId);
          return v
            ? { ...v, quantity: line.quantity, lineTotal: v.unitPrice * line.quantity, purchasable: v.available }
            : {
                variantId: line.variantId, productSlug: "", nameEn: "", nameAr: "", colorEn: "", colorAr: "",
                sizeCode: "", unitPrice: 0, quantity: line.quantity, lineTotal: 0, purchasable: false, maxQuantity: 0,
              };
        })
      : [];
  }

  const active = signedIn ? server : guest;
  const isEmpty = signedIn ? server.data?.lines.length === 0 : local.bag.length === 0;
  return {
    signedIn,
    items,
    isEmpty,
    isPending: !isEmpty && active.isPending,
    isError: active.isError,
    /** Header badge: known at once for guests, after the first fetch for members. */
    count: signedIn ? (server.data?.count ?? 0) : local.bag.reduce((sum, l) => sum + l.quantity, 0),
    subtotal: items.filter((i) => i.purchasable).reduce((sum, i) => sum + i.lineTotal, 0),
    changeError: change.error instanceof ApiError ? change.error : null,
    add(variantId: number, quantity: number) {
      if (signedIn) change.mutate({ type: "add", variantId, quantity });
      else bagActions.add(variantId, quantity);
    },
    setQuantity(variantId: number, quantity: number) {
      if (signedIn) change.mutate({ type: "set", variantId, quantity });
      else bagActions.setQuantity(variantId, quantity);
    },
    remove(variantId: number) {
      if (signedIn) change.mutate({ type: "remove", variantId });
      else bagActions.remove(variantId);
    },
  };
}

/** Mounted once in the layout: after sign-in, moves this browser's bag into the account's bag. */
export function useBagSync() {
  const me = useMe();
  const { bag } = useBagState();
  const client = useQueryClient();
  const busy = useRef(false);

  useEffect(() => {
    if (!me.data || bag.length === 0 || busy.current) return;
    busy.current = true;
    api<Cart>("POST", "/api/v1/cart/merge", { items: bag.slice(0, MAX_LINES) })
      .then((cart) => {
        bagActions.clearBag();
        client.setQueryData(CART_KEY, cart);
      })
      .catch(() => {
        // Left in this browser; the next page view tries again.
      })
      .finally(() => {
        busy.current = false;
      });
  }, [me.data, bag, client]);
}
