import { existsSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const PRODUCT = "/product/demo-harbour-stand-collar-jacket"; // local demo data: EGP 2,450
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "owner@lupin.local";
const PASSWORD_FILE = "../backend/.local-owner-password";
const ownerPassword =
  process.env.E2E_OWNER_PASSWORD ?? (existsSync(PASSWORD_FILE) ? readFileSync(PASSWORD_FILE, "utf8").trim() : "");

/** The opening animation plays once per browser session; tests start as a returning visitor. */
async function skipIntro(page: Page) {
  await page.addInitScript(() => window.sessionStorage.setItem("lupin.intro", "1"));
}

test.describe.serial("buying and fulfilling an order", () => {
  let reference = "";

  test("a new customer buys with cash on delivery, cancels and restores the order", async ({ page }) => {
    await skipIntro(page);
    const email = `e2e-${Date.now()}@example.test`;

    await page.goto(PRODUCT);
    await page.getByRole("button", { name: "M", exact: true }).click();
    await page.getByRole("button", { name: /Add to bag/ }).click();
    await expect(page.getByText("Added to your bag.")).toBeVisible();

    await page.goto("/bag");
    await expect(page.getByText("EGP 2,450 each")).toBeVisible();
    await page.getByRole("link", { name: "Checkout", exact: true }).click();

    // Guests are asked to sign in first and come back to checkout with their bag.
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.getByLabel("Full name").fill("E2E Customer");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("e2e-test-password-123");
    await page.locator("form button[type=submit]").click();

    await expect(page).toHaveURL(/\/checkout$/);
    await page.getByLabel("Mobile number").fill("01012345678");
    await page.getByLabel("Governorate").selectOption({ label: "Cairo" });
    await page.getByLabel("City / area").fill("Nasr City");
    await page.getByLabel("Street address").fill("12 Example Street");
    await page.getByRole("radio", { name: /Cash on delivery/ }).check();
    // Subtotal 2,450 + demo standard delivery 60, computed by the server.
    await expect(page.getByText("EGP 2,510")).toBeVisible();
    await page.getByRole("button", { name: "Place order" }).click();

    await expect(page).toHaveURL(/\/orders\/LP-\d+/);
    await expect(page.getByText("Thank you. Your order is placed.")).toBeVisible();
    reference = new URL(page.url()).pathname.split("/").pop() ?? "";

    await page.getByRole("button", { name: "Cancel order" }).click();
    await page.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(page.getByRole("button", { name: "Undo cancel" })).toBeVisible();
    await page.getByRole("button", { name: "Undo cancel" }).click();
    await expect(page.getByRole("button", { name: "Cancel order" })).toBeVisible();

    await page.goto("/account");
    await expect(page.getByRole("link", { name: new RegExp(reference) })).toBeVisible();
  });

  test("staff confirm the order, then cancel it so the demo stock is released", async ({ page }) => {
    test.skip(!ownerPassword, "No local owner password (backend/.local-owner-password or E2E_OWNER_PASSWORD).");
    test.skip(!reference, "The customer test did not produce an order.");
    await skipIntro(page);

    await page.goto(`/sign-in?next=/admin/orders/${reference}`);
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill(ownerPassword);
    await page.locator("form button[type=submit]").click();

    await expect(page.getByRole("heading", { name: reference })).toBeVisible();
    await page.getByRole("button", { name: "Confirm order" }).click();
    await page.getByRole("button", { name: "Yes, do it" }).click();
    await expect(page.getByRole("button", { name: "Start preparing" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel order" }).click();
    await page.getByRole("button", { name: "Yes, do it" }).click();
    await expect(page.getByText("Nothing more to do on this order.")).toBeVisible();

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  });
});

test("a customer account cannot open the staff dashboard", async ({ page }) => {
  await skipIntro(page);
  await page.goto("/sign-in?next=/admin");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("E2E Visitor");
  await page.getByLabel("Email").fill(`e2e-visitor-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("e2e-test-password-123");
  await page.locator("form button[type=submit]").click();
  await expect(page.getByRole("heading", { name: "Staff only." })).toBeVisible();
});

test("guests browse without any 'who am I' request, and Arabic is right-to-left on a phone", async ({ page }) => {
  await skipIntro(page);
  const authCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/auth/")) authCalls.push(request.url());
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);

  await page.goto("/ar/shop/men");
  await expect(page.locator("main a[href*='/ar/product/']").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(authCalls).toEqual([]);
});

test("private pages send guests to sign in, and crawler files are served", async ({ page, request }) => {
  await skipIntro(page);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount/);

  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toContain("User-agent: *");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  const xml = await sitemap.text();
  expect(xml).toContain("<urlset");
  expect(xml).toContain("/product/demo-harbour-stand-collar-jacket");
  expect(xml).not.toContain("/admin");
});
