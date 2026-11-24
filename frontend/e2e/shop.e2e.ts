import { expect, test, type Page } from "@playwright/test";
import { ownerPassword, signInAsOwner, skipIntro } from "./helpers";

/**
 * The shop counter, driven the way staff use it at the till: pick sizes, type the shop's own price (also
 * with an Arabic keyboard), sell, then return part of it, with stock checked after every step.
 * Runs against the throwaway test stack (run-e2e.ps1).
 */
test.describe.serial("shop counter", () => {
  test.skip(!ownerPassword, "No local owner password (backend/.local-owner-password or E2E_OWNER_PASSWORD).");

  const name = `E2E Shop Tee ${Date.now()}`;
  let receipt = "";

  /** Calls the API from inside the signed-in page, with the CSRF header the app itself sends. */
  async function call<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
    return page.evaluate(
      async ({ method, path, body }) => {
        const token = () => document.cookie.split("; ").find((c) => c.startsWith("XSRF-TOKEN="))?.split("=")[1];
        if (!token()) await fetch("/api/v1/auth/csrf", { credentials: "same-origin" });
        const response = await fetch(path, {
          method,
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json", "X-XSRF-TOKEN": decodeURIComponent(token() ?? "") },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${await response.text()}`);
        return response.status === 204 ? null : response.json();
      },
      { method, path, body },
    ) as Promise<T>;
  }

  async function stock(page: Page, size: string): Promise<number> {
    const pieces = await call<{ sizeCode: string; available: number }[]>(
      page, "GET", `/api/v1/admin/shop/pieces?q=${encodeURIComponent(name)}`);
    return pieces.find((p) => p.sizeCode === size)!.available;
  }

  const piece = (page: Page, size: string) => page.getByRole("button", { name: `Add ${name} Black ${size}`, exact: true });
  const line = (page: Page) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Remove/ }) });

  test.beforeEach(async ({ page }) => {
    await skipIntro(page);
  });

  test("set up: a product with 5 of M and 2 of L", async ({ page }) => {
    await signInAsOwner(page, "/admin/shop");
    await call(page, "POST", "/api/v1/admin/products", {
      nameEn: name, nameAr: "تيشيرت تجريبي", departmentSlug: "men", categorySlug: "utility",
      price: 900, sizeGroup: "ADULT", sizes: ["M", "L"],
      colors: [{ nameEn: "Black", nameAr: "أسود", hex: "#0B0B0C", main: true, images: [] }],
      initialStockPerVariant: 5,
    });
    const pieces = await call<{ variantId: number; sizeCode: string }[]>(
      page, "GET", `/api/v1/admin/shop/pieces?q=${encodeURIComponent(name)}`);
    const large = pieces.find((p) => p.sizeCode === "L")!.variantId;
    await call(page, "POST", `/api/v1/admin/inventory/${large}/adjust`, { delta: -3, note: "e2e" });
    expect(await stock(page, "M")).toBe(5);
    expect(await stock(page, "L")).toBe(2);
  });

  test("a sale at the shop's own price, typed with Arabic digits, takes the pieces out of stock", async ({ page }) => {
    await signInAsOwner(page, "/admin/shop");
    await expect(page.getByRole("heading", { name: "Shop", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Dashboard" }).getByRole("link", { name: "Shop" })).toBeVisible();

    await page.getByLabel("Product name or SKU").fill(name);
    await expect(piece(page, "M")).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete sale" })).toBeDisabled();

    // Two taps on M, one on L; L cannot go past the 2 there are.
    await piece(page, "M").click();
    await piece(page, "M").click();
    await piece(page, "L").click();
    await piece(page, "L").click();
    await expect(piece(page, "L")).toBeDisabled();
    await expect(line(page)).toHaveCount(2);

    const prices = page.getByLabel("Shop price (each)");
    await prices.nth(0).fill("١٧٥٠"); // Arabic keyboard
    await prices.nth(1).fill("12.345"); // too many decimals: refused before it reaches the server
    await expect(page.getByRole("button", { name: "Complete sale" })).toBeDisabled();
    await prices.nth(1).fill("800٫50");
    await expect(prices.nth(0)).toHaveValue("1750");
    await expect(prices.nth(1)).toHaveValue("800.50");
    await expect(page.getByText("EGP 5,101")).toBeVisible(); // 2 × 1,750 + 2 × 800.50

    await page.getByText("InstaPay", { exact: true }).click();
    await page.getByLabel(/Customer name/).fill("Walk-in test");
    await page.getByRole("button", { name: "Complete sale" }).dblclick(); // a double tap saves once
    const saved = page.getByRole("status").filter({ hasText: "Sale saved" });
    await expect(saved).toBeVisible();
    receipt = (await saved.getByText(/receipt #\d+/).textContent())!.match(/#(\d+)/)![1];

    expect(await stock(page, "M")).toBe(3);
    expect(await stock(page, "L")).toBe(0);
    const sales = await call<{ items: { id: number }[] }>(page, "GET", `/api/v1/admin/shop/sales?kind=SALE&pageSize=100`);
    expect(sales.items.filter((s) => s.id === Number(receipt))).toHaveLength(1);
  });

  test("a return against the receipt puts part of it back, never more than was sold", async ({ page }) => {
    await signInAsOwner(page, "/admin/shop?tab=receipts");
    const card = page.getByRole("listitem").filter({ hasText: `#${receipt}` }).first();
    await expect(card).toContainText("2 × " + name);
    await expect(card).toContainText("InstaPay");
    await card.getByRole("button", { name: "Return pieces" }).click();
    await expect(page).toHaveURL(new RegExp(`tab=return&receipt=${receipt}`));

    const orig = page.locator("section", { has: page.getByRole("heading", { name: new RegExp(`Receipt #${receipt}`) }) });
    await orig.getByRole("button", { name: "Return" }).first().click(); // the M line
    const qty = page.getByLabel(`How many ${name}`);
    await expect(qty).toHaveValue("2");
    await qty.fill("9"); // more than was sold: held at 2
    await expect(qty).toHaveValue("2");
    await page.getByLabel("One less").click();
    await expect(qty).toHaveValue("1");
    await expect(page.getByLabel("Money back (each)")).toHaveValue("1750");
    await page.getByRole("button", { name: "Complete return" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Return saved" })).toBeVisible();
    expect(await stock(page, "M")).toBe(4);

    // Back on the receipt, one M is already back and only one more can come.
    await page.goto(`/admin/shop?tab=return&receipt=${receipt}`);
    await expect(orig).toContainText("1 already back");
    await orig.getByRole("button", { name: "Return" }).first().click();
    await expect(page.getByLabel(`How many ${name}`)).toHaveValue("1");
    await expect(page.getByLabel("One more")).toBeDisabled();
  });

  test("a piece sold before the dashboard can come back without a receipt", async ({ page }) => {
    await signInAsOwner(page, "/admin/shop?tab=return");
    await page.getByLabel("Receipt number").fill("abc");
    await page.getByRole("button", { name: "Find" }).click();
    await expect(page.getByText("Type the receipt number in digits")).toBeVisible();
    await page.getByRole("button", { name: "No receipt" }).click();

    await page.getByLabel("Product name or SKU").fill(name);
    await piece(page, "L").click(); // sold out, but can still come back
    await page.getByLabel("Money back (each)").fill("700");
    await page.getByRole("button", { name: "Complete return" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Return saved" })).toBeVisible();
    expect(await stock(page, "L")).toBe(1);

    await page.goto("/admin/shop?tab=receipts");
    await expect(page.getByRole("listitem").filter({ hasText: "Back from receipt" }).first()).toBeVisible();
    await expect(page.getByText("Returned today")).toBeVisible();
  });

  test("something not on the site goes on the receipt with its price, and stock does not move", async ({ page }) => {
    await signInAsOwner(page, "/admin/shop");
    const before = { m: await stock(page, "M"), l: await stock(page, "L") };
    const what = `Gift wrap ${Date.now()}`;

    const box = page.locator("form", { has: page.getByRole("heading", { name: "Not on the site?" }) });
    await expect(box.getByRole("button", { name: "Add to receipt" })).toBeDisabled();
    await box.getByLabel("What was sold").fill(what);
    await box.getByLabel("Price").fill("٧٥"); // Arabic keyboard
    await box.getByRole("button", { name: "Add to receipt" }).click();
    await expect(box.getByLabel("What was sold")).toHaveValue("");

    // It sits in the basket with a piece from the site.
    await page.getByLabel("Product name or SKU").fill(name);
    await piece(page, "M").click();
    await expect(line(page)).toHaveCount(2);
    await expect(line(page).filter({ hasText: what })).toContainText("Not on the site");
    await page.getByLabel(`How many ${what}`).fill("2");
    await expect(page.getByText("Total")).toContainText("EGP"); // 2 × 75 + the M at its online price
    await page.getByRole("button", { name: "Complete sale" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Sale saved" })).toBeVisible();
    expect(await stock(page, "M")).toBe(before.m - 1);
    expect(await stock(page, "L")).toBe(before.l);

    await page.goto("/admin/shop?tab=receipts");
    const card = page.getByRole("listitem").filter({ hasText: what }).first();
    await expect(card).toContainText(`2 × ${what}`);
    await expect(card).toContainText("not on the site");
    await expect(card).toContainText("@ EGP 75");

    // Back against the receipt: money only.
    await card.getByRole("button", { name: "Return pieces" }).click();
    const orig = page.locator("section", { has: page.getByRole("heading", { name: /^Receipt #/ }) });
    await orig.getByRole("listitem").filter({ hasText: what }).getByRole("button", { name: "Return" }).click();
    await expect(page.getByLabel(`How many ${what}`)).toHaveValue("2");
    await page.getByRole("button", { name: "Complete return" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Return saved" })).toBeVisible();
    expect(await stock(page, "M")).toBe(before.m - 1);
  });
});
