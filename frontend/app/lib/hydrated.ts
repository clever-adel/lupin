import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * False in the server-rendered HTML and until React has taken over the page in the browser, then true.
 *
 * Forms that hold a password keep their submit button disabled until then: before hydration a press
 * would be an ordinary browser submit that puts every field (the password too) into the address bar,
 * browser history and server logs. A disabled default button also stops Enter from submitting.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}
