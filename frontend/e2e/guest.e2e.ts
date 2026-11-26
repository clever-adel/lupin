import { expect, test } from "@playwright/test";
import { addToBag, ownerPassword, signInAsOwner, skipIntro } from "./helpers";

const PRODUCT = "/product/demo-harbour-stand-collar-jacket"; // local demo data: EGP 2,450

test("a shopper checks out as a guest and is offered an account afterwards", async ({ page }) => {
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

  // "Create an account" opens the sign-up form; keeping the orders is covered by CheckoutIT. Not
  // submitted here: the API allows 10 sign-ups per address in 10 minutes and the rest of the suite
  // already uses all of them.
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Full name")).toBeVisible();
});

/** Fills the WhatsApp number and English address in the dashboard (Content → Contact details), as the owner does. */
async function setContact(page: import("@playwright/test").Page, whatsapp: string, address: string) {
  await signInAsOwner(page, "/admin/content");
  const form = page.locator("form", { has: page.getByLabel("Phone", { exact: true }) });
  await form.getByLabel("WhatsApp number for the chat button (empty = the phone above)").fill(whatsapp);
  await form.getByLabel("Address (English), opens in Google Maps").fill(address);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("status")).toHaveText(/Saved/);
  await page.context().clearCookies();
}

test("the WhatsApp button and the footer address come from the dashboard", async ({ page }) => {
  test.skip(!ownerPassword, "No local owner password (backend/.local-owner-password or E2E_OWNER_PASSWORD).");
  await skipIntro(page);
  await page.goto(PRODUCT);
  // Hidden while the store has no mobile number to chat with, and no address in the footer.
  await expect(page.getByRole("link", { name: "Ask us on WhatsApp" })).toHaveCount(0);
  await expect(page.locator("footer").getByRole("link", { name: /Google Maps/ })).toHaveCount(0);

  // A wrong number is refused with a clear message.
  await signInAsOwner(page, "/admin/content");
  const form = page.locator("form", { has: page.getByLabel("Phone", { exact: true }) });
  await form.getByLabel("WhatsApp number for the chat button (empty = the phone above)").fill("12345");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toContainText("Egyptian mobile number");
  await page.context().clearCookies();

  await setContact(page, "+20 102 208 8004", "12 Example St, Nasr City, Cairo");
  await page.goto(PRODUCT);
  const button = page.getByRole("link", { name: "Ask us on WhatsApp" });
  await expect(button).toBeVisible();
  const href = (await button.getAttribute("href")) ?? "";
  expect(href).toMatch(/^https:\/\/wa\.me\/201022088004\?text=/);
  expect(decodeURIComponent(href)).toContain(PRODUCT);

  const map = page.locator("footer").getByRole("link", { name: /12 Example St, Nasr City, Cairo/ });
  await expect(map).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=12%20Example%20St%2C%20Nasr%20City%2C%20Cairo");
  await expect(map).toHaveAttribute("target", "_blank");

  await page.setViewportSize({ width: 375, height: 800 });
  await expect(button).toBeInViewport();
  // Not on checkout, where it would sit over the form.
  await page.goto("/checkout");
  await expect(page.getByRole("link", { name: "Ask us on WhatsApp" })).toHaveCount(0);
  await setContact(page, "", "");
});
