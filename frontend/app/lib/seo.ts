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

/** The store's Meta (Facebook) app: links shares on Facebook to its insights. Public by design. */
const FACEBOOK_APP_ID = "1773021700473195";

/** The logo itself (transparent PNG): what search engines show as the brand's logo. */
export const DEFAULT_SHARE_IMAGE = "/brand/lupin-logo.png";

/**
 * Shown when a page has no photo of its own, so shared links always carry a picture: the logo on the
 * brand's black, at the 1200×630 size WhatsApp, Facebook and X crop link previews to.
 */
export const SHARE_CARD = { url: "/brand/share-image.png", width: 1200, height: 630 };

/**
 * What the published Exchange & returns policy says (policies/exchange-returns): requests within 24
 * hours of delivery; the customer pays return shipping unless the item is faulty. Search engines show
 * this next to the price. Change both together.
 */
export const RETURN_POLICY = {
  "@type": "MerchantReturnPolicy",
  applicableCountry: "EG",
  returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
  merchantReturnDays: 1,
  returnMethod: "https://schema.org/ReturnByMail",
  returnFees: "https://schema.org/ReturnShippingFees",
} as const;

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
  const shareImage = absoluteUrl(origin, image ?? SHARE_CARD.url);

  const tags: MetaDescriptor[] = [
    { title: fullTitle },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: canonical },
    { tagName: "link", rel: "alternate", hrefLang: "en", href: english },
    { tagName: "link", rel: "alternate", hrefLang: "ar", href: arabic },
    { tagName: "link", rel: "alternate", hrefLang: "x-default", href: english },
    { property: "fb:app_id", content: FACEBOOK_APP_ID },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { property: "og:locale", content: isArabic ? "ar_EG" : "en_EG" },
    { property: "og:type", content: type },
    { property: "og:image", content: shareImage },
    { property: "og:image:alt", content: fullTitle },
    // Size known only for the brand card; a product photo's own size is read by the network.
    ...(image ? [] : [
      { property: "og:image:width", content: String(SHARE_CARD.width) },
      { property: "og:image:height", content: String(SHARE_CARD.height) },
    ]),
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: shareImage },
  ];
  if (noindex) tags.push({ name: "robots", content: "noindex, nofollow" });
  return tags;
}

/** Finds the store layout's loader data from a meta function's matches. */
export function layoutOrigin(matches: ReadonlyArray<{ id: string; data?: unknown } | undefined>): string {
  const layout = matches.find((m) => m?.id === "routes/store/layout");
  return (layout?.data as { origin?: string } | undefined)?.origin ?? "";
}
