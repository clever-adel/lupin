import { beforeEach, describe, expect, it, vi } from "vitest";
import stealth from "./__fixtures__/product-stealth.json";

const responses = new Map<string, unknown>();
vi.mock("~/lib/api.server", () => ({
  siteOrigin: () => "https://lupinwear.store",
  apiGet: async (_context: unknown, path: string) => {
    for (const [prefix, body] of responses) if (path.startsWith(prefix)) return structuredClone(body);
    throw new Error(`unexpected ${path}`);
  },
}));

const { loader } = await import("./catalog-meta");

async function feed() {
  const response = await loader({ context: {} } as never);
  return { response, lines: (await response.text()).trim().split("\n") };
}

describe("Meta catalogue feed", () => {
  beforeEach(() => {
    responses.clear();
    responses.set("/api/v1/catalog/products?", { items: [{ slug: stealth.slug }], page: 0, size: 48, total: 1, totalPages: 1 });
    responses.set(`/api/v1/catalog/products/${stealth.slug}`, stealth);
  });

  it("lists a live product under the id the Pixel sends, with sale price, photos and sizes", async () => {
    const { response, lines } = await feed();
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(lines).toHaveLength(2);
    const row = lines[1]!;
    expect(row).toContain(`"${stealth.id}","The Stealth (Team 365 Soft Shell Jacket)"`);
    expect(row).toContain('"in stock","new","990.00 EGP","790.00 EGP"');
    expect(row).toContain('"https://lupinwear.store/product/the-stealth-team-365-soft-shell-jacket"');
    expect(row).toContain(`"https://lupinwear.store${stealth.colors[0]!.images[0]!.url}"`);
    expect(row).toContain('"Team 365","black/sport silver"');
    expect(row).toContain('"male","adult","Men > Jackets"');
  });

  it("marks a product out of stock when no size is left, and quotes text safely", async () => {
    const soldOut = structuredClone(stealth);
    soldOut.colors.forEach((c) => c.variants.forEach((v) => (v.available = false)));
    soldOut.descriptionEn = 'Say "hi",\nthen leave.';
    responses.set(`/api/v1/catalog/products/${stealth.slug}`, soldOut);
    const { lines } = await feed();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"out of stock"');
    expect(lines[1]).toContain('"Say ""hi"", then leave.');
  });

  it("leaves out a product without photos, which Meta would refuse", async () => {
    const noPhotos = structuredClone(stealth);
    noPhotos.colors.forEach((c) => (c.images = []));
    responses.set(`/api/v1/catalog/products/${stealth.slug}`, noPhotos);
    const { lines } = await feed();
    expect(lines).toHaveLength(1);
  });
});
