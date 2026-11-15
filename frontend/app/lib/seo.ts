import type { MetaDescriptor } from "react-router";

interface SeoInput {
  /** Site origin from the layout loader, e.g. https://lupinwear.store */
  origin: string;
  pathname: string;
  title: string;
  description: string;
  image?: string;
  /** Open Graph type: "product" on product pages, "website" everywhere else. */
  type?: "website" | "product";
  noindex?: boolean;
}

const SITE_NAME = "LUPIN.";

/** Shown when a page has no photo of its own, so shared links always carry a picture. */
export const DEFAULT_SHARE_IMAGE = "/brand/lupin-logo.png";

/**
 * Social networks and search engines need full addresses. Our own media and brand files are
 * referenced as "/media/..." or "/brand/...", so they get the site origin in front.
 */
export function absoluteUrl(origin: string, url: string): string {
  return url.startsWith("/") && !url.startsWith("//") ? origin + url : url;
}

function stripLang(pathname: string): string {
  if (pathname === "/ar") return "/";
  return pathname.startsWith("/ar/") ? pathname.slice(3) : pathname;
}

/** Title, description, canonical, hreflang alternates and Open Graph for one page. */
export function seo({ origin, pathname, title, description, image, type = "website", noindex }: SeoInput): MetaDescriptor[] {
  const base = stripLang(pathname);
  const english = origin + (base === "/" ? "/" : base);
  const arabic = origin + (base === "/" ? "/ar" : `/ar${base}`);
  const isArabic = pathname !== base || pathname === "/ar";
  const canonical = isArabic ? arabic : english;
  const fullTitle = title === SITE_NAME ? title : `${title} | ${SITE_NAME}`;

  const tags: MetaDescriptor[] = [
    { title: fullTitle },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: canonical },
    { tagName: "link", rel: "alternate", hrefLang: "en", href: english },
    { tagName: "link", rel: "alternate", hrefLang: "ar", href: arabic },
    { tagName: "link", rel: "alternate", hrefLang: "x-default", href: english },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { property: "og:locale", content: isArabic ? "ar_EG" : "en_EG" },
    { property: "og:type", content: type },
    { property: "og:image", content: absoluteUrl(origin, image ?? DEFAULT_SHARE_IMAGE) },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: description },
  ];
  if (noindex) tags.push({ name: "robots", content: "noindex, nofollow" });
  return tags;
}

/** Finds the store layout's loader data from a meta function's matches. */
export function layoutOrigin(matches: ReadonlyArray<{ id: string; data?: unknown } | undefined>): string {
  const layout = matches.find((m) => m?.id === "routes/store/layout");
  return (layout?.data as { origin?: string } | undefined)?.origin ?? "";
}
