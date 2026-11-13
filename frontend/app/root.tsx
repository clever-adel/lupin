import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useContext, useEffect, useState } from "react";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import { localePath, translate } from "./lib/i18n";
import { NonceContext } from "./lib/nonce";
import type { Lang } from "./lib/types";

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/png", href: "/brand/favicon.png" },
  { rel: "apple-touch-icon", href: "/brand/apple-touch-icon.png" },
];

function langFromPath(pathname: string): Lang {
  return pathname === "/ar" || pathname.startsWith("/ar/") ? "ar" : "en";
}

// Runs before first paint: on later page loads in the same session the opening animation never shows.
const INTRO_SCRIPT =
  "try{if(sessionStorage.getItem('lupin.intro')){document.documentElement.classList.add('intro-seen')}" +
  "else{sessionStorage.setItem('lupin.intro','1')}}catch(e){}";

export function Layout({ children }: { children: React.ReactNode }) {
  const lang = langFromPath(useLocation().pathname);
  const nonce = useContext(NonceContext);
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0B0B0C" />
        <Meta />
        <Links />
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const lang = langFromPath(useLocation().pathname);
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  // The back end can be asleep for a minute or more; retry a few times on its own before giving up.
  useEffect(() => {
    if (notFound) return;
    let tries = 0;
    try {
      tries = Number(sessionStorage.getItem("lupin.retry") ?? "0");
    } catch {
      return;
    }
    if (tries >= 6) return;
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem("lupin.retry", String(tries + 1));
      } catch {
        /* ignore */
      }
      window.location.reload();
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [notFound]);
  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-6 text-center text-bone">
      <div>
        <img src="/brand/lupin-mark.png" alt="LUPIN." width={396} height={251} className="mx-auto h-12 w-auto" />
        <h1 className="display mt-10 text-2xl md:text-3xl">
          {translate(lang, notFound ? "error.notFoundTitle" : "error.title")}
        </h1>
        <p className="mt-3 text-sm text-bone/70">
          {translate(lang, notFound ? "error.notFoundText" : "error.waking")}
        </p>
        {notFound ? (
          <Link to={localePath(lang, "/")} className="btn btn-light mt-8">
            {translate(lang, "error.backHome")}
          </Link>
        ) : (
          <button type="button" className="btn btn-light mt-8" onClick={() => window.location.reload()}>
            {translate(lang, "error.retry")}
          </button>
        )}
      </div>
    </main>
  );
}
