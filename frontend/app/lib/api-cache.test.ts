import { describe, expect, it } from "vitest";
import { cacheSeconds, isShareable, shared, type EdgeCache } from "./api-cache";

function memoryCache() {
  const store = new Map<string, Response>();
  const cache: EdgeCache = {
    match: async (key) => store.get(key)?.clone(),
    put: async (key, response) => {
      store.set(key, response);
    },
  };
  return { cache, store };
}

describe("edge cache for public store data", () => {
  it("shares products, departments, looks, reviews and content, and nothing personal", () => {
    expect(isShareable("GET", "/api/v1/catalog/products")).toBe(true);
    expect(isShareable("GET", "/api/v1/catalog/products/demo-bomber/reviews")).toBe(true);
    expect(isShareable("GET", "/api/v1/catalog/looks")).toBe(true);
    expect(isShareable("GET", "/api/v1/content/site")).toBe(true);
    expect(isShareable("GET", "/api/v1/catalog/variants")).toBe(false);
    expect(isShareable("GET", "/api/v1/cart")).toBe(false);
    expect(isShareable("GET", "/api/v1/admin/products")).toBe(false);
    expect(isShareable("GET", "/api/v1/orders/LUP-1")).toBe(false);
    expect(isShareable("POST", "/api/v1/catalog/products")).toBe(false);
    expect(isShareable("GET", "/api/v1/catalog/products", new Headers({ "X-Lupin-Fresh": "1" }))).toBe(false);
  });

  it("only caches on the real site", () => {
    expect(cacheSeconds("https://lupinwear.store")).toBe(30);
    expect(cacheSeconds("http://localhost:5173")).toBe(0);
  });

  it("asks the API once, then answers from the copy without telling browsers to keep it", async () => {
    const { cache } = memoryCache();
    const pending: Promise<unknown>[] = [];
    let calls = 0;
    const load = async () => {
      calls++;
      return Response.json({ n: calls }, { headers: { "Cache-Control": "no-store" } });
    };
    const first = await shared(cache, "k", 30, (p) => pending.push(p), load);
    expect(await first.json()).toEqual({ n: 1 });
    await Promise.all(pending);
    const second = await shared(cache, "k", 30, (p) => pending.push(p), load);
    expect(await second.json()).toEqual({ n: 1 });
    expect(second.headers.get("Cache-Control")).toBe("no-store");
    expect(second.headers.get("X-Edge-Cache")).toBe("HIT");
    expect(calls).toBe(1);
  });

  it("never keeps errors or answers that set a cookie", async () => {
    const { cache, store } = memoryCache();
    const pending: Promise<unknown>[] = [];
    await shared(cache, "a", 30, (p) => pending.push(p), async () => new Response("down", { status: 502 }));
    await shared(cache, "b", 30, (p) => pending.push(p), async () =>
      Response.json({}, { headers: { "Set-Cookie": "XSRF-TOKEN=abc" } }));
    await Promise.all(pending);
    expect(store.size).toBe(0);
  });

  it("goes straight to the API when caching is off", async () => {
    const { cache, store } = memoryCache();
    await shared(cache, "k", 0, () => undefined, async () => Response.json({}));
    expect(store.size).toBe(0);
  });
});
