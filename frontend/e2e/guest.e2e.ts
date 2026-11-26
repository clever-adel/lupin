import { expect, test } from "@playwright/test";
import { addToBag, ownerPassword, signInAsOwner, skipIntro, unique } from "./helpers";

const PRODUCT = "/product/demo-harbour-stand-collar-jacket"; // local demo data: EGP 2,450

test("a shopper checks out as a guest, then makes an account and keeps the order", async ({ page }) => {
  await skipIntro(page);
  await addToBag(page, PRODUCT, "M");
  await page.goto("/bag");
  await page.getByRole("link", { name: "Checkout", exact: true }).click();

  // On the way to checkout the guest option comes first; no email or password is asked for.
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await expect(page.getByRole("heading", { name: "New here? No account needed" })).toBeVisible();
  await page.getByRole("button", { name: "Continue as guest" }).click();

  await expect(page).toHaveURL(/\/checkout$/);
  // The guest's placeholder name is never put in the form.
  await expect(page.getByLabel("Recipient name")).toHaveValue("");
  await page.getByLabel("Recipient name").fill("Guest Shopper");
  await page.getByLabel("Mobile number").fill("01112345678");
  await page.getByLabel("Governorate").selectOption({ label: "Cairo" });
  await page.getByLabel("City / area").fill("Maadi");
  await page.getByLabel("Street address").fill("5 Example Street");
  await page.getByRole("radio", { name: /Cash on delivery/ }).check();
  await expect(page.getByText("EGP 2,510")).toBeVisible();
  await page.getByRole("button", { name: "Place order" }).click();

  await expect(page).toHaveURL(/\/orders\/LP-\d+/);
  await expect(page.getByText("Thank you. Your order is placed.")).toBeVisible();
  const reference = new URL(page.url()).pathname.split("/").pop() ?? "";

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Hi there" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(reference) })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Change password" })).toHaveCount(0);

  // Making an account from here keeps the order with it.
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Full name").fill("Guest Shopper");
  await page.getByLabel("Email").fill(`${unique("guest")}@example.test`);
  await page.getByLabel("Password").fill("e2e-test-password-123");
  await page.locator("form button[type=submit]").click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Hi, Guest" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(reference) })).toBeVisible();
});

/** Sets the store's WhatsApp number as the owner would in the dashboard (Content → contact). */
async function setWhatsApp(page: import("@playwright/test").Page, number: string) {
  await signInAsOwner(page);
  const status = await page.evaluate(async (value) => {
    const xsrf = document.cookie.split("; ").find((c) => c.startsWith("XSRF-TOKEN="))?.split("=")[1] ?? "";
    const res = await fetch("/api/v1/admin/settings/contact", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": decodeURIComponent(xsrf) },
      body: JSON.stringify({ whatsappNumber: value }),
    });
    return res.status;
  }, number);
  expect(status).toBe(200);
  await page.context().clearCookies();
}

test("a WhatsApp button on store pages opens a chat about the piece", async ({ page }) => {
  test.skip(!ownerPassword, "No local owner password (backend/.local-owner-password or E2E_OWNER_PASSWORD).");
  await skipIntro(page);
  await page.goto(PRODUCT);
  // Hidden while the store has no mobile number to chat with.
  await expect(page.getByRole("link", { name: "Ask us on WhatsApp" })).toHaveCount(0);
  await setWhatsApp(page, "01022088004");
  await page.goto(PRODUCT);
  const button = page.getByRole("link", { name: "Ask us on WhatsApp" });
  await expect(button).toBeVisible();
  const href = (await button.getAttribute("href")) ?? "";
  expect(href).toMatch(/^https:\/\/wa\.me\/201022088004\?text=/);
  expect(decodeURIComponent(href)).toContain(PRODUCT);
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(button).toBeInViewport();
  // Not on checkout, where it would sit over the form.
  await page.goto("/checkout");
  await expect(page.getByRole("link", { name: "Ask us on WhatsApp" })).toHaveCount(0);
  await setWhatsApp(page, "");
});
