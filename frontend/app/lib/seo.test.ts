import { describe, expect, it } from "vitest";
import { absoluteUrl, seo } from "./seo";

const origin = "https://lupinwear.store";

function find(tags: ReturnType<typeof seo>, predicate: (t: Record<string, unknown>) => boolean) {
  return tags.find((t) => predicate(t as Record<string, unknown>)) as Record<string, unknown> | undefined;
}

describe("seo", () => {
  it("points the canonical at the page's own language and lists both alternates", () => {
    const tags = seo({ origin, pathname: "/ar/shop/men", title: "رجالي", description: "d" });
    expect(find(tags, (t) => t.rel === "canonical")?.href).toBe("https://lupinwear.store/ar/shop/men");
    expect(find(tags, (t) => t.hrefLang === "en")?.href).toBe("https://lupinwear.store/shop/men");
    expect(find(tags, (t) => t.hrefLang === "ar")?.href).toBe("https://lupinwear.store/ar/shop/men");
    expect(find(tags, (t) => t.hrefLang === "x-default")?.href).toBe("https://lupinwear.store/shop/men");
    expect(find(tags, (t) => t.property === "og:locale")?.content).toBe("ar_EG");
  });

  it("handles the two home pages", () => {
    expect(find(seo({ origin, pathname: "/", title: "LUPIN.", description: "d" }), (t) => t.rel === "canonical")?.href)
      .toBe("https://lupinwear.store/");
    expect(find(seo({ origin, pathname: "/ar", title: "LUPIN.", description: "d" }), (t) => t.rel === "canonical")?.href)
      .toBe("https://lupinwear.store/ar");
  });

  it("suffixes the brand once and marks private pages noindex", () => {
    const tags = seo({ origin, pathname: "/bag", title: "Your bag", description: "d", noindex: true });
    expect(find(tags, (t) => "title" in t)?.title).toBe("Your bag | LUPIN.");
    expect(find(tags, (t) => t.name === "robots")?.content).toBe("noindex, nofollow");
    expect(find(seo({ origin, pathname: "/", title: "LUPIN.", description: "d" }), (t) => "title" in t)?.title).toBe("LUPIN.");
  });

  it("always gives a full image address, with the brand image when the page has none", () => {
    const own = seo({ origin, pathname: "/product/x", title: "X", description: "d", image: "/media/a.jpg", type: "product" });
    expect(find(own, (t) => t.property === "og:image")?.content).toBe("https://lupinwear.store/media/a.jpg");
    expect(find(own, (t) => t.property === "og:type")?.content).toBe("product");
    expect(find(own, (t) => t.name === "twitter:card")?.content).toBe("summary_large_image");

    const none = seo({ origin, pathname: "/faq", title: "FAQ", description: "d" });
    expect(find(none, (t) => t.property === "og:image")?.content).toBe("https://lupinwear.store/brand/lupin-logo.png");
    expect(find(none, (t) => t.property === "og:type")?.content).toBe("website");
  });

  it("leaves addresses that are already full alone", () => {
    expect(absoluteUrl(origin, "https://res.cloudinary.com/x.jpg")).toBe("https://res.cloudinary.com/x.jpg");
    expect(absoluteUrl(origin, "//cdn.example/x.jpg")).toBe("//cdn.example/x.jpg");
    expect(absoluteUrl(origin, "/media/a.jpg")).toBe("https://lupinwear.store/media/a.jpg");
  });
});
