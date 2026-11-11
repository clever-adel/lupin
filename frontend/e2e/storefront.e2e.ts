import { expect, test } from "@playwright/test";
import { addToBag, CUSTOMER_PASSWORD, registerCustomer, skipIntro, unique } from "./helpers";

/**
 * The customer-facing buttons and forms not already covered by store.e2e.ts: shop filters, the
 * product page controls, the guest bag, language switching, sign-in errors and checkout validation.
 * Uses the fresh demo data of the test stack: six jackets, three on sale, XXL sold out.
 */
test.beforeEach(async ({ page }) => {
  await skipIntro(page);
});

test("shop: search, sort, filters and clearing them", async ({ page }) => {
  // Counts are checked inside the demo categories, so products added by other tests do not matter.
  await page.goto("/shop/men?category=lightweight");
  await expect(page.getByText("2 styles")).toBeVisible();

  await page.goto("/shop/men");
  await page.getByLabel("Search").fill("bomber");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/q=bomber/);
  await expect(page.getByText("1 styles")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nightfall Bomber" })).toBeVisible();

  await page.getByLabel("Search").fill("zzz-nothing");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Nothing matches. Try fewer filters.")).toBeVisible();

  // Sorting, inside one category: Ember is EGP 1,760 and Slate EGP 2,040 (both discount prices).
  await page.goto("/shop/men?category=windbreakers");
  await page.getByLabel("Sort").selectOption("price_asc");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/category=windbreakers/); // the category survives the form
  await expect(page.locator("main article h2").first()).toHaveText("Ember Windbreaker");
  await page.getByLabel("Sort").selectOption("price_desc");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator("main article h2").first()).toHaveText("Slate Shell Jacket");

  // "On sale" inside Lightweight leaves only the Dune jacket.
  await page.goto("/shop/men?category=lightweight");
  await page.locator("details", { hasText: "Filters" }).first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await page.getByRole("checkbox", { name: "On sale" }).check();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/sale=true/);
  await expect(page.getByText("1 styles")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dune Light Jacket" })).toBeVisible();

  // A sold-out size finds nothing; a price floor narrows the list.
  await page.goto("/shop/men?category=bombers&size=XXL");
  await expect(page.getByText("Nothing matches. Try fewer filters.")).toBeVisible();
  await page.goto("/shop/men?category=lightweight&size=M&minPrice=2400");
  await expect(page.getByText("1 styles")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Harbour Stand-Collar Jacket" })).toBeVisible();

  await page.locator("details", { hasText: "Filters" }).first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await page.getByRole("link", { name: "Clear all" }).click();
  await expect(page).not.toHaveURL(/minPrice|size=/);

  // Category tabs.
  await page.goto("/shop/men");
  await page.getByRole("link", { name: "Bombers", exact: true }).click();
  await expect(page).toHaveURL(/category=bombers/);
  await expect(page.getByText("1 styles")).toBeVisible();

  // Departments that are not open yet say so instead of showing an empty shop.
  await page.goto("/shop/women");
  await expect(page.getByRole("heading", { name: "Women is coming soon." })).toBeVisible();
});

test("product page: sizes, colours, quantity, favourites and the size reminder", async ({ page }) => {
  await page.goto("/product/demo-nightfall-bomber");

  // Adding without a size asks for one instead of failing silently.
  await page.getByRole("button", { name: /Add to bag/ }).click();
  await expect(page.getByText("Choose a size first.")).toBeVisible();

  await expect(page.getByRole("button", { name: "XXL, sold out" })).toBeDisabled();
  await page.getByRole("button", { name: "Navy", exact: true }).click();
  await expect(page.getByText("Colour: Navy")).toBeVisible();

  // Quantity: the button shows the price for the chosen quantity, and cannot go below one.
  await page.getByRole("button", { name: "S", exact: true }).click();
  await expect(page.getByRole("button", { name: "Decrease quantity" })).toBeDisabled();
  await page.getByRole("button", { name: "Increase quantity" }).click();
  await expect(page.getByRole("button", { name: /Add to bag/ })).toContainText("EGP 5,500");
  await page.getByRole("button", { name: "Decrease quantity" }).click();
  await expect(page.getByRole("button", { name: /Add to bag/ })).toContainText("EGP 2,750");

  // Favourites toggle and its counter in the header.
  await page.getByRole("button", { name: "Save to favourites" }).click();
  await expect(page.getByRole("button", { name: "Remove from favourites" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Favourites\s*1$/ })).toBeVisible();
  await page.goto("/bag");
  await expect(page.getByRole("heading", { name: "Your favourites" })).toBeVisible();
  await page.locator("#favourites").getByRole("link", { name: /Nightfall Bomber/ }).click();
  await expect(page).toHaveURL(/\/product\/demo-nightfall-bomber$/);
  await page.getByRole("button", { name: "Remove from favourites" }).click();
  await expect(page.getByRole("link", { name: /^Favourites$/ })).toBeVisible();

  // Details open and close; the breadcrumb leads back to the category.
  await page.getByText("Fabric & fit").click();
  await expect(page.getByText("Demo fabric text")).toBeVisible();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Bombers" }).click();
  await expect(page).toHaveURL(/\/shop\/men\?category=bombers$/);
});

test("guest bag: quantities, remove, and it survives a reload", async ({ page }) => {
  await addToBag(page, "/product/demo-dune-light-jacket", "M");
  await page.getByRole("link", { name: "View bag" }).click();
  await expect(page).toHaveURL(/\/bag$/);
  await expect(page.getByText("EGP 2,070 each")).toBeVisible(); // the discount price, from the server

  await page.getByRole("button", { name: "Increase quantity" }).click();
  await expect(page.getByRole("status")).toHaveText("2");
  await expect(page.getByLabel("Summary").getByText("EGP 4,140")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("2");
  await page.getByRole("button", { name: "Decrease quantity" }).click();
  await expect(page.getByRole("status")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Decrease quantity" })).toBeDisabled();

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Your bag is empty.")).toBeVisible();
  await page.getByRole("link", { name: "Continue shopping" }).click();
  await expect(page).toHaveURL(/\/shop$/);
});

test("language switch keeps the page and its filters, both ways", async ({ page }) => {
  await page.goto("/shop/men?category=windbreakers&sale=true");
  await page.getByRole("link", { name: "العربية" }).click();
  await expect(page).toHaveURL(/\/ar\/shop\/men\?category=windbreakers&sale=true$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByText("2 موديل")).toBeVisible();
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/shop\/men\?category=windbreakers&sale=true$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("missing pages show a helpful not-found page", async ({ page }) => {
  const missing = await page.goto("/product/no-such-product");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Nothing here." })).toBeVisible();
  await page.getByRole("link", { name: "Back to the store" }).click();
  await expect(page).toHaveURL(/\/$/);

  expect((await page.goto("/fr/shop"))?.status()).toBe(404); // only English and Arabic exist
  expect((await page.goto("/policies/not-a-policy"))?.status()).toBe(404);
});

test("sign in and sign up: every error a customer can hit, and no redirect to other sites", async ({ page }) => {
  await page.goto("/sign-in");

  // Sign in: empty, malformed, then wrong.
  await page.locator("form button[type=submit]").click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();
  await page.getByLabel("Email").fill("nobody@example.test");
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.locator("form button[type=submit]").click();
  await expect(page.getByRole("alert")).toContainText("Email or password is not correct.");

  // Sign up: field rules.
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("A");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Mobile number (optional)").fill("12345");
  await page.getByLabel("Password").fill("short");
  await page.locator("form button[type=submit]").click();
  await expect(page.getByText("Enter your full name.")).toBeVisible();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByText("Enter an Egyptian mobile number, e.g. 01012345678.")).toBeVisible();
  await expect(page.getByText("Use at least 10 characters.")).toBeVisible();

  // A real sign-up, then the same email again is refused.
  const email = `${unique("e2e-dup")}@example.test`;
  await page.getByLabel("Full name").fill("E2E Duplicate");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mobile number (optional)").fill("");
  await page.getByLabel("Password").fill(CUSTOMER_PASSWORD);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Hi, E2E" })).toBeVisible();
  await expect(page.getByText("No orders yet.")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("E2E Duplicate");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(CUSTOMER_PASSWORD);
  await page.locator("form button[type=submit]").click();
  await expect(page.getByRole("alert")).toContainText("already exists");

  // "next" pointing at another site is ignored: the customer lands on their own account.
  await page.goto("/sign-in?next=https://evil.example/steal");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(CUSTOMER_PASSWORD);
  await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/localhost:\d+\/account$/);
});

test("checkout: validation, delivery choices per governorate, promo errors, and an empty bag", async ({ page }) => {
  await registerCustomer(page);
  await page.goto("/checkout");
  await expect(page.getByText("Your bag is empty.")).toBeVisible();

  await addToBag(page, "/product/demo-slate-shell-jacket", "L"); // EGP 2,040
  await page.goto("/checkout");

  // Pressing the button with nothing filled says exactly what is missing.
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText("Enter an Egyptian mobile number, e.g. 01012345678.")).toBeVisible();
  await expect(page.getByText("Choose a governorate.")).toBeVisible();
  await expect(page.getByText("Enter your city or area.")).toBeVisible();
  await expect(page.getByText("Enter your street address.")).toBeVisible();
  await expect(page).toHaveURL(/\/checkout$/);

  // Cairo has standard and express; Alexandria only standard. The total follows the choice.
  await expect(page.getByText("Choose a governorate to see delivery options.")).toBeVisible();
  await page.getByLabel("Governorate").selectOption({ label: "Cairo" });
  await expect(page.getByRole("radio", { name: /Express delivery/ })).toBeVisible();
  await expect(page.getByText("EGP 2,100")).toBeVisible(); // 2,040 + 60
  await page.getByRole("radio", { name: /Express delivery/ }).check();
  await expect(page.getByText("EGP 2,160")).toBeVisible(); // 2,040 + 120
  await page.getByLabel("Governorate").selectOption({ label: "Alexandria" });
  await expect(page.getByRole("radio", { name: /Express delivery/ })).toHaveCount(0);
  await expect(page.getByText("EGP 2,100")).toBeVisible();

  // An unknown promo code is explained and changes nothing; removing it clears the message.
  await page.getByLabel("Promo code").fill("nope-123");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("This code is not valid.")).toBeVisible();
  await expect(page.getByText("EGP 2,100")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("This code is not valid.")).toHaveCount(0);

  // A wrong phone number is caught before anything is sent.
  await page.getByLabel("Mobile number").fill("0123");
  await page.getByLabel("City / area").fill("Smouha");
  await page.getByLabel("Street address").fill("7 Example Street");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText("Enter an Egyptian mobile number, e.g. 01012345678.")).toBeVisible();
  await expect(page).toHaveURL(/\/checkout$/);

  await page.getByRole("link", { name: "Back to bag" }).first().click();
  await expect(page).toHaveURL(/\/bag$/);
  await page.getByRole("button", { name: "Remove" }).click(); // leave no reserved or stray bag behind
  await expect(page.getByText("Your bag is empty.")).toBeVisible();
});
