import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./http";

/** The browser API client: CSRF header, one silent refresh on 401, and one error shape. */
describe("api client", () => {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  let responses: Response[] = [];

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  beforeEach(() => {
    calls.length = 0;
    document.cookie = "XSRF-TOKEN=token-123; path=/";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body as string | undefined });
      const next = responses.shift();
      if (!next) throw new Error(`Unexpected request to ${url}`);
      return next;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "XSRF-TOKEN=; path=/; max-age=0";
  });

  it("sends JSON with the CSRF token on writes, and no token on reads", async () => {
    responses = [json(200, { count: 1 }), json(200, [])];
    await api("PUT", "/api/v1/cart/items/7", { quantity: 2 });
    await api("GET", "/api/v1/cart");

    expect(calls[0]).toMatchObject({ url: "/api/v1/cart/items/7", method: "PUT", body: '{"quantity":2}' });
    expect(calls[0]?.headers["X-XSRF-TOKEN"]).toBe("token-123");
    expect(calls[0]?.headers["Content-Type"]).toBe("application/json");
    expect(calls[1]?.headers["X-XSRF-TOKEN"]).toBeUndefined();
  });

  it("refreshes the session once after a 401 and repeats the request", async () => {
    responses = [json(401, { code: "UNAUTHENTICATED" }), json(200, {}), json(200, { ok: true })];
    await expect(api("GET", "/api/v1/orders")).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/orders", "/api/v1/auth/refresh", "/api/v1/orders"]);
  });

  it("gives up with a 401 error when the refresh fails, without looping", async () => {
    responses = [json(401, { code: "UNAUTHENTICATED", message: "Please sign in." }), json(401, { code: "SESSION_EXPIRED" })];
    const error = await api("GET", "/api/v1/orders").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(calls).toHaveLength(2);
  });

  it("does not try to refresh when signing in fails", async () => {
    responses = [json(401, { code: "INVALID_CREDENTIALS", message: "Email or password is not correct." })];
    const error = (await api("POST", "/api/v1/auth/login", { email: "a@b.c", password: "x" }).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("INVALID_CREDENTIALS");
    expect(error.message).toBe("Email or password is not correct.");
    expect(calls).toHaveLength(1);
  });

  it("carries the server's code, message and field errors", async () => {
    responses = [json(400, { code: "VALIDATION_FAILED", message: "Some fields need attention.", fields: { phone: "Enter an Egyptian mobile number" } })];
    const error = (await api("POST", "/api/v1/orders", {}).catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ status: 400, code: "VALIDATION_FAILED", fields: { phone: "Enter an Egyptian mobile number" } });
  });

  it("returns nothing for 204 and survives a non-JSON error page", async () => {
    responses = [new Response(null, { status: 204 }), new Response("<html>Bad gateway</html>", { status: 502 })];
    await expect(api("POST", "/api/v1/auth/logout")).resolves.toBeUndefined();
    const error = (await api("GET", "/api/v1/cart").catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ status: 502, code: "ERROR" });
  });
});
