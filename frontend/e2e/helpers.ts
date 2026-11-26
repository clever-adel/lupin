import { createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, type Browser, type Cookie, type Page } from "@playwright/test";

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

/**
 * Opens a page and waits until React has taken over it. Buttons pressed before that do nothing, which
 * made tests fail now and then on a slow machine ("Choose a size first." after a size was clicked).
 */
export async function gotoReady(page: Page, path: string) {
  await page.goto(path);
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
}

/** A fresh browser (no cookies), e.g. to act as a second person in the same test. */
export async function newVisitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await skipIntro(page);
  return page;
}

export async function signIn(page: Page, email: string, password: string, next?: string) {
  await gotoReady(page, next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.locator("form button[type=submit]").click();
}

// ── Two-step sign-in for staff: the tests act as the authenticator app. ──

/** The local owner's app key, so later runs against the same local database can sign in. Git-ignored. */
const OWNER_KEY_FILE = "../backend/.local-owner-totp";
const appKeys = new Map<string, string>();
const lastStep = new Map<string, number>();

function base32Decode(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text.replace(/\s/g, "").toUpperCase()) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238, as the phone apps do it: HMAC-SHA1, 30-second steps, 6 digits. */
export function appCode(key: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac("sha1", base32Decode(key)).update(counter).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const currentStep = () => Math.floor(Date.now() / 30_000);

/** A fresh code: the server accepts each code once, so wait for the next one if this one was used. */
async function nextCode(email: string): Promise<string> {
  let key = appKeys.get(email);
  if (!key && email === OWNER_EMAIL && existsSync(OWNER_KEY_FILE)) {
    key = readFileSync(OWNER_KEY_FILE, "utf8").trim();
    appKeys.set(email, key);
    // An earlier test run may have used this very code a moment ago: start from the next one.
    lastStep.set(email, currentStep());
  }
  if (!key) throw new Error(`No authenticator key known for ${email}`);
  while (currentStep() <= (lastStep.get(email) ?? -1)) await new Promise((resolve) => setTimeout(resolve, 1000));
  lastStep.set(email, currentStep());
  return appCode(key, currentStep());
}

/** The dashboard's "Turn on two-step sign-in" screen, done as a staff member would. */
export async function pairAuthenticator(page: Page, email: string) {
  await page.getByRole("button", { name: "Show the QR code" }).click();
  const key = (await page.getByLabel("Setup key").innerText()).replace(/\s/g, "");
  appKeys.set(email, key);
  if (email === OWNER_EMAIL) writeFileSync(OWNER_KEY_FILE, key);
  await page.getByLabel(/Type the 6-digit code/).fill(await nextCode(email));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  await page.getByLabel("I have saved them somewhere safe").check();
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Staff sign-in: password, then either the app code or (first time) pairing the app. */
export async function signInStaff(page: Page, email: string, password: string, next?: string) {
  await signIn(page, email, password, next);
  const code = page.getByLabel("Code", { exact: true });
  const pairing = page.getByRole("heading", { name: "Turn on two-step sign-in" });
  await expect(code.or(pairing)).toBeVisible();
  if (await code.isVisible()) {
    await code.fill(await nextCode(email));
    await page.getByRole("button", { name: "Confirm" }).click();
  } else {
    await pairAuthenticator(page, email);
  }
}

/**
 * The owner's session, kept from the first sign-in of this test run. The API allows 10 sign-ins per
 * account in 10 minutes, and the whole suite signs in as the owner more often than that.
 */
let ownerSession: Cookie[] | null = null;

export async function signInAsOwner(page: Page, next = "/admin") {
  const landed = new RegExp(next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
  if (ownerSession) {
    await page.context().addCookies(ownerSession);
    await page.goto(next);
    if (landed.test(page.url())) return;
  }
  await signInStaff(page, OWNER_EMAIL, ownerPassword, next);
  await expect(page).toHaveURL(landed);
  await expect(page.getByRole("navigation", { name: "Dashboard" })).toBeVisible();
  ownerSession = await page.context().cookies();
}

/** Creates a customer through the sign-up form and returns their email. */
export async function registerCustomer(page: Page, next = "/account"): Promise<string> {
  const email = `${unique("e2e")}@example.test`;
  await gotoReady(page, `/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("E2E Customer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(CUSTOMER_PASSWORD);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(new RegExp(next + "$"));
  return email;
}

export async function addToBag(page: Page, productPath: string, size: string) {
  await gotoReady(page, productPath);
  await page.getByRole("button", { name: size, exact: true }).click();
  await page.getByRole("button", { name: /Add to bag/ }).click();
  await expect(page.getByText("Added to your bag.")).toBeVisible();
}

/** Fills checkout for Cairo and places the order with the given payment method. Returns the order reference. */
export async function placeOrder(page: Page, payment: RegExp, promoCode?: string): Promise<string> {
  await gotoReady(page, "/checkout");
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
