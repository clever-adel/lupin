import { existsSync, readFileSync } from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";

const PASSWORD_FILE = "../backend/.local-owner-password";

export const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "owner@lupin.local";
/** Local demo owner only. Empty when the file is missing; tests that need it skip themselves. */
export const ownerPassword =
  process.env.E2E_OWNER_PASSWORD ?? (existsSync(PASSWORD_FILE) ? readFileSync(PASSWORD_FILE, "utf8").trim() : "");

export const CUSTOMER_PASSWORD = "e2e-test-password-123";
export const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/** The opening animation plays once per browser session; tests start as a returning visitor. */
export async function skipIntro(page: Page) {
  await page.addInitScript(() => window.sessionStorage.setItem("lupin.intro", "1"));
}

/** A fresh browser (no cookies), e.g. to act as a second person in the same test. */
export async function newVisitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await skipIntro(page);
  return page;
}

export async function signIn(page: Page, email: string, password: string, next?: string) {
  await page.goto(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.locator("form button[type=submit]").click();
}

export async function signInAsOwner(page: Page, next = "/admin") {
  await signIn(page, OWNER_EMAIL, ownerPassword, next);
  await expect(page).toHaveURL(new RegExp(next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
}

/** Creates a customer through the sign-up form and returns their email. */
export async function registerCustomer(page: Page, next = "/account"): Promise<string> {
  const email = `${unique("e2e")}@example.test`;
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("E2E Customer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(CUSTOMER_PASSWORD);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(new RegExp(next + "$"));
  return email;
}

export async function addToBag(page: Page, productPath: string, size: string) {
  await page.goto(productPath);
  await page.getByRole("button", { name: size, exact: true }).click();
  await page.getByRole("button", { name: /Add to bag/ }).click();
  await expect(page.getByText("Added to your bag.")).toBeVisible();
}

/** Fills checkout for Cairo and places the order with the given payment method. Returns the order reference. */
export async function placeOrder(page: Page, payment: RegExp, promoCode?: string): Promise<string> {
  await page.goto("/checkout");
  await page.getByLabel("Mobile number").fill("01012345678");
  await page.getByLabel("Governorate").selectOption({ label: "Cairo" });
  await page.getByLabel("City / area").fill("Nasr City");
  await page.getByLabel("Street address").fill("12 Example Street");
  await page.getByRole("radio", { name: payment }).check();
  if (promoCode) {
    await page.getByLabel("Promo code").fill(promoCode);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText(`Code ${promoCode.toUpperCase()} applied.`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/orders\/LP-\d+/);
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}
