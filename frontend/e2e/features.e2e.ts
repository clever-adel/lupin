import { expect, test, type Page } from "@playwright/test";
import { addToBag, gotoReady, newVisitor, ownerPassword, signInAsOwner, skipIntro } from "./helpers";

/**
 * The size guide, size finder, sizes and stock while editing, duplicating, "You may also steal",
 * shipping with any courier and a tracking link, reviews, reports, staff roles and rich FAQ text,
 * each driven the way staff and customers use them. Runs against the throwaway test stack.
 */
test.describe.serial("shop features", () => {
  test.skip(!ownerPassword, "No local owner password (backend/.local-owner-password or E2E_OWNER_PASSWORD).");

  const stamp = Date.now().toString().slice(-7);
  const productName = `E2E Pit Stop ${stamp}`;
  let productPath = "";
  let productId = "";

  const section = (page: Page, heading: string) =>
    page.locator("section", { has: page.getByRole("heading", { name: heading, exact: true }) });

  test.beforeEach(async ({ page }) => {
    await skipIntro(page);
  });

  test("a product sold in S and M gets an L while editing, a Bershka size chart, and a copy", async ({ page }) => {
    await signInAsOwner(page, "/admin/products/new");
    await page.getByLabel("Name (English)", { exact: true }).fill(productName);
    await page.getByLabel("Name (Arabic)", { exact: true }).fill("هودي تجريبي");
    await page.getByText(/Add a new category to/).click();
    await page.getByLabel("Category name (English)").fill(`Hoodie ${stamp}`);
    await page.getByLabel("Category name (Arabic)").fill("هودي");
    await page.getByRole("button", { name: "Add category" }).click();
    await page.getByLabel("Price (EGP)").fill("900");
    await page.getByRole("checkbox", { name: "S", exact: true }).check();
    await page.getByRole("checkbox", { name: "M", exact: true }).check();
    await page.getByLabel("Colour name (English)").fill("Black");
    await page.getByLabel("Colour name (Arabic)").fill("أسود");
    await page.locator("#stock-0-S").fill("4");
    await page.locator("#stock-0-M").fill("4");
    await page.getByRole("button", { name: "Create draft product" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/\d+$/);
    productId = page.url().split("/").pop() ?? "";

    // Sizes and stock are in front of staff while editing.
    const sizes = section(page, "Sizes and stock");
    await expect(sizes).toContainText("Sold in: S · M");
    await expect(sizes.getByRole("rowheader", { name: /Black · S/ })).toBeVisible();
    const sizeOptions = await sizes.getByRole("combobox").locator("option").allTextContents();
    expect(sizeOptions).toEqual(["Choose…", "XS", "L", "XL", "XXL", "3XL", "One size"]);
    await sizes.getByRole("combobox").selectOption("L");
    await sizes.getByLabel("Stock · Black").fill("3");
    await sizes.getByRole("button", { name: "Add size L" }).click();
    await expect(sizes.getByText("Size added.")).toBeVisible();
    await expect(sizes).toContainText("Sold in: S · M · L");
    const lRow = sizes.locator("tbody tr", { hasText: "Black · L" });
    await expect(lRow.locator("td").nth(0)).toHaveText("3");
    await lRow.getByRole("button", { name: /\+1: add one Black L/ }).click();
    await expect(lRow.locator("td").nth(0)).toHaveText("4");

    // One click fills the Bershka chart for S, M and the new L.
    const chart = section(page, "Size chart");
    await chart.getByRole("button", { name: "Bershka men's hoodies & sweatshirts" }).click();
    await expect(chart.getByLabel("Chest for size L")).toHaveValue("102-110");
    await expect(chart.getByLabel("Chest for size S")).toHaveValue("86-94");
    await chart.getByRole("button", { name: "Save size chart" }).click();
    await expect(chart.getByText("Saved.")).toBeVisible();

    // Put it on sale.
    await page.goto(`/admin/products?q=${encodeURIComponent(productName)}`);
    const card = page.locator("main li", { hasText: productName }).first();
    await card.getByRole("button", { name: "Put on sale" }).click();
    await expect(card).toContainText("On sale");
    const listed = await (await page.request.get(`/api/v1/catalog/products?q=${encodeURIComponent(productName)}`)).json();
    productPath = `/product/${listed.items[0].slug}`;

    // Duplicate: a hidden draft with the same sizes and chart, no stock.
    await page.goto(`/admin/products/${productId}`);
    await page.getByRole("button", { name: "Duplicate product" }).click();
    await expect(page.getByRole("heading", { name: `${productName} (copy)` })).toBeVisible();
    const copySizes = section(page, "Sizes and stock");
    await expect(copySizes).toContainText("Sold in: S · M · L");
    await expect(copySizes.locator("tbody tr", { hasText: "Black · L" }).locator("td").nth(0)).toHaveText("0");
    await expect(section(page, "Size chart").getByLabel("Chest for size L")).toHaveValue("102-110");
  });

  test("shoppers see the size guide, find their size, and other pieces to steal", async ({ page }) => {
    await page.goto(productPath);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();

    await page.getByText("Size guide", { exact: true }).click();
    await expect(page.getByRole("cell", { name: "102-110" })).toBeVisible();
    await page.getByRole("button", { name: "in", exact: true }).click();
    await expect(page.getByRole("cell", { name: "40¼-43¼" })).toBeVisible();
    await expect(page.getByText("How to measure")).toBeVisible();
    await expect(page.getByText("International sizes")).toBeVisible();

    await page.getByText("Find my size", { exact: true }).click();
    await page.getByLabel("Height (cm)").fill("175");
    await page.getByLabel("Weight (kg)").fill("70");
    await page.getByRole("button", { name: "Suggest" }).click();
    await expect(page.getByText("Your size:")).toContainText("M");
    await page.getByRole("button", { name: "Choose M" }).click();
    await expect(page.getByRole("button", { name: "M", exact: true })).toHaveAttribute("aria-pressed", "true");

    await page.getByLabel("Weight (kg)").fill("90");
    await page.getByLabel("Height (cm)").fill("185");
    await page.getByRole("button", { name: "Suggest" }).click();
    await expect(page.getByText("Your size:")).toContainText("L");

    await page.getByLabel("Height (cm)").fill("195");
    await page.getByLabel("Weight (kg)").fill("130");
    await page.getByRole("button", { name: "Suggest" }).click();
    await expect(page.getByText(/only goes up to L, which would likely be too small/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Choose / })).toHaveCount(0);

    // Other pieces from the same department, never this one.
    await expect(page.getByRole("heading", { name: "You may also steal" })).toBeVisible();
    const others = section(page, "You may also steal").getByRole("article");
    expect(await others.count()).toBeGreaterThan(0);
    await expect(section(page, "You may also steal").getByText(productName)).toHaveCount(0);
  });

  test("an order ships with any courier and a tracking link, then the customer reviews it", async ({ page, browser }) => {
    // A guest checkout: the suite already uses every sign-up the API allows in 10 minutes.
    const customer = await newVisitor(browser);
    await addToBag(customer, productPath, "L");
    await customer.goto("/bag");
    await customer.getByRole("link", { name: "Checkout", exact: true }).click();
    await customer.getByRole("button", { name: "Continue as guest" }).click();
    await expect(customer).toHaveURL(/\/checkout$/);
    await customer.getByLabel("Recipient name").fill("Karim Hassan");
    await customer.getByLabel("Mobile number").fill("01012345678");
    await customer.getByLabel("Governorate").selectOption({ label: "Cairo" });
    await customer.getByLabel("City / area").fill("Nasr City");
    await customer.getByLabel("Street address").fill("12 Example Street");
    await customer.getByRole("radio", { name: /Cash on delivery/ }).check();
    await customer.getByRole("button", { name: "Place order" }).click();
    await expect(customer).toHaveURL(/\/orders\/LP-\d+/);
    const reference = new URL(customer.url()).pathname.split("/").pop() ?? "";

    await signInAsOwner(page, `/admin/orders/${reference}`);
    for (const [button] of [["Confirm order"], ["Start preparing"]]) {
      await page.getByRole("button", { name: button }).click();
      await page.getByRole("button", { name: "Yes, do it" }).click();
    }
    await page.getByRole("button", { name: "Mark as shipped" }).click();
    await page.getByLabel("Courier (optional)").fill("Mylerz");
    await page.getByLabel("Tracking number (optional)").fill("MZ-E2E");
    await page.getByLabel("Tracking link (optional)").fill("https://track.example.com/MZ-E2E");
    await page.getByRole("button", { name: "Yes, do it" }).click();
    await expect(page.getByText("Mylerz · MZ-E2E")).toBeVisible();
    await expect(page.getByRole("link", { name: "tracking page" })).toHaveAttribute("href", "https://track.example.com/MZ-E2E");

    await customer.reload();
    await expect(customer.getByRole("link", { name: "Track your parcel" })).toHaveAttribute("href", "https://track.example.com/MZ-E2E");
    await expect(customer.getByText("Rate your pieces")).toHaveCount(0); // not delivered yet

    await page.getByRole("button", { name: "Mark as delivered" }).click();
    await page.getByRole("button", { name: "Yes, do it" }).click();
    await expect(page.getByText("Nothing more to do on this order.")).toBeVisible();

    await customer.reload();
    await expect(customer.getByText("Rate your pieces")).toBeVisible();
    await customer.getByRole("radio", { name: "5 out of 5 stars" }).click();
    await customer.getByPlaceholder(/How is the fit/).fill("Boxy and warm, L fits well.");
    await customer.getByRole("button", { name: "Send review" }).click();
    await expect(customer.getByText("Thank you! We will publish it after a quick check.")).toBeVisible();

    // Hidden until staff publish it.
    await customer.goto(productPath);
    await expect(customer.getByRole("heading", { name: "Reviews" })).toHaveCount(0);
    await page.goto("/admin/reviews");
    const review = page.locator("main li", { hasText: "Boxy and warm, L fits well." });
    await review.getByRole("button", { name: "Publish" }).click();
    await expect(review).toHaveCount(0);
    await customer.goto(productPath);
    await expect(customer.getByRole("heading", { name: "Reviews" })).toBeVisible();
    await expect(customer.getByText("Boxy and warm, L fits well.")).toBeVisible();
    await expect(customer.getByText("· 1 reviews")).toBeVisible();
    await expect(customer.getByText("Karim H.", { exact: true })).toBeVisible(); // the name on the order

    // The sale is in the owner's report and spreadsheet.
    await page.goto("/admin/reports");
    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByRole("heading", { name: "Best sellers" })).toBeVisible();
    await expect(page.locator("section", { hasText: "Best sellers" }).getByText(productName)).toBeVisible();
    const href = await page.getByRole("link", { name: "Download orders (Excel)" }).getAttribute("href");
    const csv = await (await page.request.get(href ?? "")).text();
    expect(csv).toContain(`"${reference}"`);
    expect(csv).toContain('"Mylerz"');
  });

  test("the owner promotes and demotes a staff member", async ({ page }) => {
    await signInAsOwner(page, "/admin/staff");
    const email = `e2e-role-${stamp}@example.test`;
    await page.getByLabel("Full name").fill("E2E Role");
    await page.getByLabel("Email they will sign in with").fill(email);
    await page.getByLabel("First password (12+ characters)").fill("e2e-role-password-123");
    await page.getByRole("button", { name: "Add staff member" }).click();
    const person = page.locator("main li", { hasText: email });
    await expect(person).toContainText("Admin: daily work");
    await person.getByRole("button", { name: "Make owner" }).click();
    await person.getByRole("button", { name: "Yes, change role" }).click();
    await expect(person).toContainText("Owner: everything");
    await person.getByRole("button", { name: "Make admin" }).click();
    await person.getByRole("button", { name: "Yes, change role" }).click();
    await expect(person).toContainText("Admin: daily work");
  });

  test("staff arrange the shop and the store follows that order", async ({ page }) => {
    await signInAsOwner(page, "/admin/arrange");
    const rows = page.locator("main ol > li");
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(2);
    const last = (await rows.nth(count - 1).locator("span.truncate").textContent()) ?? "";
    await page.getByRole("button", { name: `Move ${last} to the top` }).click();
    await expect(rows.first()).toContainText(last);
    await page.getByRole("button", { name: "Save order" }).click();
    await expect(page.getByText("Saved. The store shows this order now.")).toBeVisible();

    // The store lists it first, unless it is sold out (sold-out pieces always come last).
    const shop = await (await page.request.get("/api/v1/catalog/products?pageSize=48")).json();
    const first = shop.items.find((c: { inStock: boolean }) => c.inStock);
    const moved = shop.items.find((c: { nameEn: string }) => c.nameEn === last);
    if (moved.inStock) expect(first.nameEn).toBe(last);
    else expect(shop.items[shop.items.length - 1].inStock).toBe(false);
  });

  test("home shows department photos and the newest reviews; the header search opens the shop search", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "What they say" })).toBeVisible();
    await expect(page.getByText("“Boxy and warm, L fits well.”")).toBeVisible();

    await page.getByRole("link", { name: "Find a piece" }).click();
    await expect(page).toHaveURL(/\/shop#search$/);
    await expect(page.locator("#search")).toBeFocused();
  });

  test("on a phone the buy bar follows the shopper, and Buy now goes straight to checkout", async ({ browser }) => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await phone.newPage();
    await skipIntro(page);
    await gotoReady(page, productPath);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();
    const bar = page.locator("div.fixed.bottom-0", { has: page.getByRole("button", { name: "Add to bag", exact: true }) });
    await expect(bar).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("EGP 900");

    // No size yet: the bar takes the shopper back to the sizes.
    await bar.getByRole("button", { name: "Buy now" }).click();
    await expect(page.getByText("Choose a size first.").or(page.getByRole("alert"))).toBeVisible();
    await page.getByRole("button", { name: "M", exact: true }).click();
    await page.getByRole("button", { name: "Buy now" }).first().click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fcheckout/);
    await page.getByRole("button", { name: "Continue as guest" }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByText(productName).first()).toBeVisible();
    await phone.close();
  });

  test("FAQ answers show headings, lists, bold and safe links", async ({ page }) => {
    await signInAsOwner(page, "/admin/content");
    const question = `E2E rich ${stamp}`;
    await page.locator("#qen-new").fill(question);
    await page.locator("#qar-new").fill("سؤال");
    await page.locator("#aen-new").fill("## Steps\n- Keep the **tags** on\n- See [delivery](/policies/delivery)\n\n[bad](javascript:alert(1))");
    await page.locator("#aar-new").fill("إجابة");
    await page.locator("#qen-new").locator("xpath=ancestor::form").getByRole("button", { name: "Add question" }).click();
    await expect(page.locator("form", { has: page.locator(`input[value="${question}"]`) })
      .filter({ has: page.getByRole("button", { name: "Save", exact: true }) })).toBeVisible();

    await page.goto("/faq");
    await page.getByText(question).click();
    const answer = page.locator("details", { hasText: question });
    await expect(answer.getByRole("heading", { name: "Steps" })).toBeVisible();
    await expect(answer.locator("li strong")).toHaveText("tags");
    await expect(answer.getByRole("link", { name: "delivery" })).toHaveAttribute("href", "/policies/delivery");
    await expect(answer.getByRole("link", { name: "bad" })).toHaveCount(0);
    await expect(answer).toContainText("[bad](javascript:alert(1))");
  });
});
