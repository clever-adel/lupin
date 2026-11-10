import { createContext } from "react";

/**
 * The per-request Content-Security-Policy nonce. Set by entry.server.tsx while rendering on the
 * server; undefined in the browser, where the scripts have already been admitted.
 */
export const NonceContext = createContext<string | undefined>(undefined);
