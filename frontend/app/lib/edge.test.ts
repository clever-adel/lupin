import { describe, expect, it } from "vitest";
import { httpsRedirect } from "./edge";

describe("httpsRedirect", () => {
  it("sends plain HTTP on the public site to the same address over HTTPS", () => {
    expect(httpsRedirect("http://lupinwear.store/sign-in?next=/admin")).toBe("https://lupinwear.store/sign-in?next=/admin");
    expect(httpsRedirect("http://www.lupinwear.store/")).toBe("https://www.lupinwear.store/");
  });

  it("leaves HTTPS and a developer's own machine alone", () => {
    expect(httpsRedirect("https://lupinwear.store/")).toBeNull();
    expect(httpsRedirect("http://localhost:5173/")).toBeNull();
    expect(httpsRedirect("http://127.0.0.1:5183/admin")).toBeNull();
  });
});
