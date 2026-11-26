import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import type { Route } from "./+types/layout";
import { HeaderLogo, Intro, LogoLockup, replayIntro } from "~/components/brand";
import { BagAddedFeedback } from "~/components/bag-added";
import { BagIcon, HeartIcon, UserIcon } from "~/components/icons";
import { useScrollReveal } from "~/components/reveal";
import { useMe } from "~/features/auth/session";
import { useBagState } from "~/features/bag/store";
import { useBag, useBagSync } from "~/features/bag/useBag";
import { apiGet, siteOrigin } from "~/lib/api.server";
import { switchLangPath, useT } from "~/lib/i18n";
import { startPixel, track } from "~/lib/pixel";
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
          <Link to={href("/bag")} className={iconLink} data-bag-icon>
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
  // The store's address from the dashboard (Content → Contact details), in the page's language when both
  // are filled in. Nothing is shown while it is empty.
  const address = (pick(contact, "address") || contact.addressEn || contact.addressAr || "").trim();
  const hasContact = Boolean(contact.email || contact.phone || address || pick(contact, "hours") || socials.length);
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
            <li>
              <Link to={href("/looks")} className="hover:text-bone">
                {t("look.indexTitle")}
              </Link>
            </li>
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
              {address && (
                <li>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="flex items-start gap-2 hover:text-bone"
                  >
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
                      <circle cx="12" cy="10" r="2.5" />
                    </svg>
                    <span className="max-w-56">
                      {address}
                      <span className="sr-only"> ({t("footer.map")})</span>
                    </span>
                  </a>
                </li>
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

/** An Egyptian mobile (01xxxxxxxxx, +201…, 00201…) as wa.me wants it: digits with the country code. */
export function whatsappDigits(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^01[0125]\d{8}$/.test(digits)) digits = "2" + digits;
  return /^201[0125]\d{8}$/.test(digits) ? digits : null;
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" fill="currentColor">
      <path d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.2.6 4.4 1.7 6.3L3.2 28.8l7.1-1.9c1.8 1 3.8 1.5 5.8 1.5 7 0 12.7-5.7 12.7-12.7C28.8 8.6 23 3 16 3zm0 23.1c-1.9 0-3.7-.5-5.3-1.5l-.4-.2-4.2 1.1 1.1-4.1-.3-.4c-1.1-1.7-1.6-3.6-1.6-5.5C5.3 9.8 10.1 5.2 16 5.2s10.6 4.7 10.6 10.5S21.9 26.1 16 26.1zm5.8-7.8c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1c-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2s0-.5.1-.6l.5-.6c.2-.2.2-.4.3-.6.1-.2 0-.4 0-.6s-.7-1.7-1-2.3c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4s-1.2 1.1-1.2 2.7 1.2 3.1 1.3 3.4c.2.2 2.3 3.5 5.6 4.9.8.3 1.4.5 1.9.7.8.2 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4z" />
    </svg>
  );
}

/**
 * "Ask us on WhatsApp", on every store page: shoppers ask about sizes before they order. Uses the
 * WhatsApp number from the dashboard, or the contact phone when none is set; hidden when neither is a mobile.
 */
function WhatsAppButton({ site, origin }: { site: SiteContent; origin: string }) {
  const { t } = useT();
  const { pathname } = useLocation();
  const digits = whatsappDigits(site.contact.whatsappNumber || site.contact.phone || "");
  if (!digits || pathname.includes("/checkout")) return null;
  const onProduct = pathname.includes("/product/");
  const text = onProduct
    ? t("whatsapp.aboutProduct", { url: origin + pathname })
    : t("whatsapp.hello");
  return (
    <a
      href={`https://wa.me/${digits}?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track("Contact")}
      className="fixed end-4 bottom-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-[#25D366] text-white shadow-lg hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:end-6 md:bottom-6"
    >
      <WhatsAppIcon />
      <span className="sr-only">{t("whatsapp.label")}</span>
    </a>
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
  // Ads tracking: one PageView per page the shopper sees (nothing while no Pixel ID is set).
  const pixelId = loaderData.site.metaPixelId;
  useEffect(() => {
    if (startPixel(pixelId)) track("PageView");
  }, [pixelId, pathname]);

  return (
    <>
      <Intro />
      <Announcement site={loaderData.site} />
      <Header departments={loaderData.departments} />
      <BagAddedFeedback />
      <main id="main" tabIndex={-1} className="outline-none">
        <Outlet />
      </main>
      <Footer departments={loaderData.departments} site={loaderData.site} />
      <WhatsAppButton site={loaderData.site} origin={loaderData.origin} />
    </>
  );
}
