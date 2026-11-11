import { existsSync, readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD_FILE = "../backend/.local-owner-password";
const ownerPassword =
  process.env.E2E_OWNER_PASSWORD ?? (existsSync(PASSWORD_FILE) ? readFileSync(PASSWORD_FILE, "utf8").trim() : "");

/** WCAG 2.1 A and AA rules that a machine can check. It does not replace a manual screen-reader pass. */
async function scan(page: Page, label: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.map(
    (v) => `${label}: ${v.id} (${v.impact}) — ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`,
  );
}

async function skipIntro(page: Page) {
  await page.addInitScript(() => window.sessionStorage.setItem("lupin.intro", "1"));
}

test("public pages have no automatic accessibility violations, in English and Arabic", async ({ page }) => {
  await skipIntro(page);
  const problems: string[] = [];
  for (const path of ["/", "/shop/men", "/product/demo-nightfall-bomber", "/bag", "/sign-in", "/faq"]) {
    for (const prefix of ["", "/ar"]) {
      const url = prefix + (path === "/" && prefix ? "" : path);
      await page.goto(url || "/");
      await page.waitForLoadState("networkidle");
      problems.push(...(await scan(page, url || "/")));
    }
  }
  // Filter panel and sold-out states on a phone.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/shop/men?sale=true");
  await page.waitForLoadState("networkidle");
  problems.push(...(await scan(page, "/shop/men?sale=true @375")));
  expect(problems).toEqual([]);
});

test("the opening animation has no violations and can be dismissed from the keyboard", async ({ page }) => {
  await page.goto("/");
  const problems = await scan(page, "/ with intro");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(problems).toEqual([]);
});

test("the store can be used with the keyboard alone", async ({ page }) => {
  await skipIntro(page);
  await page.goto("/");

  // First Tab reaches "Skip to content"; using it lands on the main content.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  // Every focused control shows a visible focus ring.
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
  expect(outline).toBe("solid");

  // Moving to another page puts focus at the start of the new content.
  await page.getByRole("link", { name: "Shop the collection" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.locator("#main")).toBeFocused();

  // Choose a size and add to the bag without a mouse.
  await page.goto("/product/demo-nightfall-bomber");
  await page.getByRole("button", { name: "L", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "L", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Add to bag/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Added to your bag.")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Bag\s*1$/ })).toBeVisible();

  // Sign-in tabs: arrow keys switch, focus follows.
  await page.goto("/sign-in");
  await page.getByRole("tab", { name: "Sign in" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Create account" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Full name")).toBeVisible();

  // A failed form submit moves focus to the first field that needs attention.
  await page.locator("form button[type=submit]").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Full name")).toBeFocused();
  await expect(page.getByLabel("Full name")).toHaveAttribute("aria-invalid", "true");
});

test("signed-in customer pages have no automatic accessibility violations", async ({ page }) => {
  await skipIntro(page);
  const problems: string[] = [];
  await page.goto("/product/demo-field-utility-jacket");
  await page.getByRole("button", { name: "L", exact: true }).click();
  await page.getByRole("button", { name: /Add to bag/ }).click();
  await expect(page.getByText("Added to your bag.")).toBeVisible();
  problems.push(...(await scan(page, "product after add")));

  await page.goto("/sign-in?next=/checkout");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("A11y Customer");
  await page.getByLabel("Email").fill(`e2e-a11y-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("short");
  await page.locator("form button[type=submit]").click();
  problems.push(...(await scan(page, "sign-in with errors")));
  await page.getByLabel("Password").fill("e2e-test-password-123");
  await page.locator("form button[type=submit]").click();

  await expect(page).toHaveURL(/\/checkout$/);
  await page.getByRole("button", { name: "Place order" }).click(); // shows the validation messages
  problems.push(...(await scan(page, "checkout with errors")));
  await page.getByLabel("Mobile number").fill("01012345678");
  await page.getByLabel("Governorate").selectOption({ label: "Cairo" });
  await page.getByLabel("City / area").fill("Nasr City");
  await page.getByLabel("Street address").fill("12 Example Street");
  await page.getByRole("radio", { name: /InstaPay/ }).check();
  await expect(page.getByText("EGP 2,660")).toBeVisible();
  problems.push(...(await scan(page, "checkout filled")));
  await page.getByRole("button", { name: "Place order" }).click();

  await expect(page).toHaveURL(/\/orders\/LP-\d+/);
  await expect(page.getByText(/by InstaPay to/)).toBeVisible();
  problems.push(...(await scan(page, "order awaiting transfer")));
  // Leave nothing reserved in the demo stock.
  await page.getByRole("button", { name: "Cancel order" }).click();
  await page.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByRole("button", { name: "Undo cancel" })).toBeVisible();
  problems.push(...(await scan(page, "order cancelled")));

  await page.goto("/ar/account");
  await expect(page.getByRole("link", { name: /LP-\d+/ })).toBeVisible();
  problems.push(...(await scan(page, "/ar/account")));
  expect(problems).toEqual([]);
});

test("staff dashboard pages have no automatic accessibility violations", async ({ page }) => {
  test.skip(!ownerPassword, "No local owner password.");
  await skipIntro(page);
  await page.goto("/sign-in?next=/admin");
  await page.getByLabel("Email").fill(process.env.E2E_OWNER_EMAIL ?? "owner@lupin.local");
  await page.getByLabel("Password").fill(ownerPassword);
  await page.locator("form button[type=submit]").click();
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();

  const problems: string[] = [];
  for (const path of ["/admin", "/admin/transfers", "/admin/products", "/admin/products/new", "/admin/promotions", "/admin/content", "/admin/settings", "/admin/staff"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    problems.push(...(await scan(page, path)));
  }
  await page.goto("/admin");
  await page.locator("tbody a").first().click();
  await expect(page.getByRole("heading", { name: "Next step" })).toBeVisible();
  problems.push(...(await scan(page, "/admin/orders/:reference")));
  expect(problems).toEqual([]);
});
