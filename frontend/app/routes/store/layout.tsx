import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import type { Route } from "./+types/layout";
import { HeaderLogo, Intro, LogoLockup, replayIntro } from "~/components/brand";
import { BagIcon, HeartIcon, UserIcon } from "~/components/icons";
import { useScrollReveal } from "~/components/reveal";
import { useMe } from "~/features/auth/session";
import { useBagState } from "~/features/bag/store";
import { useBag, useBagSync } from "~/features/bag/useBag";
import { apiGet, siteOrigin } from "~/lib/api.server";
import { switchLangPath, useT } from "~/lib/i18n";
import type { Department, SiteContent } from "~/lib/types";

export async function loader({ params, context }: Route.LoaderArgs) {
  if (params.lang !== undefined && params.lang !== "ar") {
    throw new Response("Not found", { status: 404 });
  }
  const [departments, site] = await Promise.all([
    apiGet<Department[]>(context, "/api/v1/catalog/departments"),
    apiGet<SiteContent>(context, "/api/v1/content/site"),
  ]);
  return { departments, site, origin: siteOrigin(context) };
}

function Count({ value }: { value: number }) {
  if (value === 0) return null;
  return (
    <span
      className="absolute -end-0.5 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-bone px-1 text-xs leading-none font-bold text-ink"
      dir="ltr"
    >
      {value}
    </span>
  );
}

function Header({ departments }: { departments: Department[] }) {
  const { t, href, pick } = useT();
  const location = useLocation();
  const { favourites } = useBagState();
  const bag = useBag();
  useBagSync();
  const me = useMe().data;
  const iconLink = "relative grid h-11 w-10 place-items-center md:w-11";

  return (
    <header className="sticky top-0 z-40 bg-ink text-bone">
      <a href="#main" className="btn btn-light sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2">
        {t("nav.skip")}
      </a>
      <div className="shell flex flex-wrap items-center justify-between gap-x-2 md:flex-nowrap md:gap-x-6">
        <Link to={href("/")} className="flex h-14 items-center" aria-label="LUPIN.">
          <HeaderLogo />
        </Link>

        <nav
          aria-label={t("nav.main")}
          className="order-last -mx-1 flex w-full gap-5 overflow-x-auto pb-3 md:order-none md:mx-0 md:w-auto md:pb-0"
        >
          {departments.map((d) => (
            <NavLink
              key={d.slug}
              to={href(`/shop/${d.slug}`)}
              className={({ isActive }) =>
                `label flex shrink-0 items-center gap-2 border-b py-1 ${isActive ? "border-bone" : "border-transparent text-bone/80 hover:text-bone"}`
              }
            >
              {pick(d, "name")}
              {d.status === "COMING_SOON" && (
                <span className="border border-bone/40 px-1 py-px text-xs leading-tight tracking-normal text-bone/70">{t("nav.soon")}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center">
          <Link
            to={switchLangPath(location.pathname, location.search)}
            className="me-1 rounded-full border border-bone/40 px-2.5 py-1 text-xs hover:border-bone md:px-3"
            lang={t("nav.switchLang") === "English" ? "en" : "ar"}
          >
            {t("nav.switchLang")}
          </Link>
          <Link to={href(me ? "/account" : "/sign-in")} className={iconLink} aria-label={t(me ? "nav.account" : "nav.signIn")}>
            <UserIcon />
          </Link>
          {/* Named by their content: a hidden word plus the visible count, so "Bag 2" is announced. */}
          <Link to={href("/bag") + "#favourites"} className={iconLink}>
            <HeartIcon />
            <span className="sr-only">{t("nav.favourites")}</span>
            <Count value={favourites.length} />
          </Link>
          <Link to={href("/bag")} className={iconLink}>
            <BagIcon />
            <span className="sr-only">{t("nav.bag")}</span>
            <Count value={bag.count} />
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Owner-written messages from the dashboard. Nothing is shown when there are none. */
function Announcement({ site }: { site: SiteContent }) {
  const { lang } = useT();
  const items = (lang === "ar" ? site.announcement.itemsAr : site.announcement.itemsEn) ?? [];
  if (items.length === 0) return null;
  return (
    <div className="bg-bone text-ink">
      <ul className="shell flex flex-wrap justify-center gap-x-8 gap-y-1 py-2 text-center text-xs font-medium">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Only links that are safe to follow: the owner types these, but the page still checks them. */
function social(url: string): string | null {
  return /^https:\/\/[^\s]+$/.test(url) ? url : null;
}

function Footer({ departments, site }: { departments: Department[]; site: SiteContent }) {
  const { t, href, pick } = useT();
  const { contact } = site;
  const socials = [
    ["Instagram", social(contact.instagram)],
    ["Facebook", social(contact.facebook)],
    ["TikTok", social(contact.tiktok)],
  ].filter((entry): entry is [string, string] => entry[1] !== null);
  const hasContact = Boolean(contact.email || contact.phone || pick(contact, "hours") || socials.length);
  return (
    <footer className="mt-24 bg-ink text-bone">
      <div className="shell grid gap-10 py-14 md:grid-cols-[1fr_auto_auto_auto]">
        <div>
          <LogoLockup className="h-auto w-44" />
          <p className="label mt-6 text-bone/60">{t("brand.supporting")}</p>
          <button type="button" onClick={replayIntro} className="mt-4 cursor-pointer text-xs text-bone/70 underline hover:text-bone">
            {t("footer.replay")}
          </button>
        </div>
        <nav aria-label={t("footer.shop")}>
          <h2 className="text-sm font-semibold">{t("footer.shop")}</h2>
          <ul className="mt-3 space-y-2 text-sm text-bone/70">
            {departments
              .filter((d) => d.status === "ACTIVE")
              .map((d) => (
                <li key={d.slug}>
                  <Link to={href(`/shop/${d.slug}`)} className="hover:text-bone">
                    {pick(d, "name")}
                  </Link>
                </li>
              ))}
          </ul>
        </nav>
        <nav aria-label={t("footer.help")}>
          <h2 className="text-sm font-semibold">{t("footer.help")}</h2>
          <ul className="mt-3 space-y-2 text-sm text-bone/70">
            <li>
              <Link to={href("/faq")} className="hover:text-bone">{t("faq.title")}</Link>
            </li>
            {site.policies.map((p) => (
              <li key={p.slug}>
                <Link to={href(`/policies/${p.slug}`)} className="hover:text-bone">{pick(p, "title")}</Link>
              </li>
            ))}
          </ul>
        </nav>
        {hasContact && (
          <div>
            <h2 className="text-sm font-semibold">{t("footer.contact")}</h2>
            <ul className="mt-3 space-y-2 text-sm text-bone/70">
              {contact.phone && (
                <li><a href={`tel:${contact.phone}`} dir="ltr" className="hover:text-bone">{contact.phone}</a></li>
              )}
              {contact.email && (
                <li><a href={`mailto:${contact.email}`} dir="ltr" className="hover:text-bone">{contact.email}</a></li>
              )}
              {pick(contact, "hours") && <li>{pick(contact, "hours")}</li>}
              {socials.map(([name, url]) => (
                <li key={name}>
                  <a href={url} rel="noopener noreferrer" target="_blank" className="hover:text-bone">{name}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="shell border-t border-bone/15 py-5 text-xs text-bone/50">
        © {new Date().getFullYear()} LUPIN. {t("footer.rights")}
      </div>
    </footer>
  );
}

export default function StoreLayout({ loaderData }: Route.ComponentProps) {
  useScrollReveal();
  // After moving to another page, put keyboard and screen-reader focus at the start of the new
  // content instead of leaving it on the link that was pressed, far down the previous page.
  const { pathname } = useLocation();
  // Compared with the previous path (not a "first render" flag) so React's development double-run of
  // effects cannot steal focus on the first page load.
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <>
      <Intro />
      <Announcement site={loaderData.site} />
      <Header departments={loaderData.departments} />
      <main id="main" tabIndex={-1} className="outline-none">
        <Outlet />
      </main>
      <Footer departments={loaderData.departments} site={loaderData.site} />
    </>
  );
}
