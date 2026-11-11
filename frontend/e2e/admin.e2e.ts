import { expect, test, type Page } from "@playwright/test";
import {
  addToBag, CUSTOMER_PASSWORD, newVisitor, ownerPassword, placeOrder, registerCustomer, signIn, signInAsOwner,
  skipIntro, unique,
} from "./helpers";

/**
 * Every screen and button of the staff dashboard, driven the way a staff member would, with the
 * effect checked where a customer sees it. Runs against the throwaway test stack (run-e2e.ps1).
 */
test.describe.serial("staff dashboard", () => {
  test.skip(!ownerPassword, "No local owner password (backend/.local-owner-password or E2E_OWNER_PASSWORD).");

  const productName = `E2E Parka ${Date.now()}`;
  let productPath = "";
  const promoCode = `E2E${Date.now().toString().slice(-7)}`;

  const section = (page: Page, heading: string) =>
    page.locator("section", { has: page.getByRole("heading", { name: heading, exact: true }) });

  test.beforeEach(async ({ page }) => {
    await skipIntro(page);
  });

  test("staff who sign in land on the dashboard, and their account page links to it", async ({ page }) => {
    await signIn(page, "owner@lupin.local", ownerPassword); // no destination given
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
    for (const name of ["Orders", "Transfers to check", "Products & stock", "Offers", "Content", "Settings", "Staff"]) {
      await expect(page.getByRole("navigation", { name: "Dashboard" }).getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
    }

    await page.getByRole("link", { name: "My password" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await page.getByRole("link", { name: "Open the staff dashboard" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("products: create with a new category, edit, put on sale, adjust stock, take off sale", async ({ page }) => {
    await signInAsOwner(page, "/admin/products");
    await page.getByRole("link", { name: "New product" }).click();
    await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();

    // Nothing can be created until the required parts are filled.
    await expect(page.getByRole("button", { name: "Create draft product" })).toBeDisabled();

    await page.getByLabel("Name (English)", { exact: true }).fill(productName);
    await page.getByLabel("Name (Arabic)", { exact: true }).fill("باركا تجريبية");
    await page.getByText(/Add a new category to/).click();
    const categoryName = `E2E Cat ${Date.now().toString().slice(-6)}`;
    await page.getByLabel("Category name (English)").fill(categoryName);
    await page.getByLabel("Category name (Arabic)").fill("فئة تجريبية");
    await page.getByRole("button", { name: "Add category" }).click();
    await expect(page.getByLabel("Category", { exact: true })).toContainText(categoryName);
    await page.getByLabel("Price (EGP)").fill("1800");
    await page.getByLabel("Description (English)").fill("Made by the dashboard test.");
    await page.getByRole("checkbox", { name: "M", exact: true }).check();
    await page.getByRole("checkbox", { name: "L", exact: true }).check();
    await page.getByLabel("Colour name (English)").fill("Black");
    await page.getByLabel("Colour name (Arabic)").fill("أسود");
    await page.getByLabel("Pieces in stock for each colour and size").fill("5");
    await page.getByRole("button", { name: "Create draft product" }).click();

    await expect(page).toHaveURL(/\/admin\/products\/\d+$/);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();

    // Edit: a discount price that is not lower is refused, a valid one is saved.
    await page.getByLabel("Discount price (EGP, empty = none)").fill("1800");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toContainText("discount price must be lower");
    await page.getByLabel("Discount price (EGP, empty = none)").fill("1500");
    await page.getByLabel("Label on the photo").selectOption("NEW");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");

    // A draft is invisible to customers.
    await page.goto(`/admin/products?q=${encodeURIComponent(productName)}`);
    const card = page.locator("main li", { hasText: productName });
    await expect(card).toContainText("Draft (hidden)");
    await expect(card).toContainText("EGP 1,500 (was EGP 1,800)");
    const shop = await page.request.get(`/api/v1/catalog/products?q=${encodeURIComponent(productName)}`);
    expect((await shop.json()).total).toBe(0);

    await card.getByRole("button", { name: "Put on sale" }).click();
    await expect(card).toContainText("On sale");
    const listed = await (await page.request.get(`/api/v1/catalog/products?q=${encodeURIComponent(productName)}`)).json();
    expect(listed.total).toBe(1);
    expect(listed.items[0].salePrice).toBe(1500);
    productPath = `/product/${listed.items[0].slug}`;

    // Stock: add, then an impossible removal is refused with a reason.
    const row = card.locator("tbody tr", { hasText: "Black · M" });
    await expect(row.locator("td").nth(0)).toHaveText("5");
    await row.getByLabel("Add or remove stock for Black M").fill("3");
    await row.getByRole("button", { name: "Apply" }).click();
    await expect(row.locator("td").nth(0)).toHaveText("8");
    await row.getByLabel("Add or remove stock for Black M").fill("-100");
    await row.getByRole("button", { name: "Apply" }).click();
    await expect(row.getByRole("alert")).toBeVisible();
    await expect(row.locator("td").nth(0)).toHaveText("8");
    // Letters are not a quantity: the button stays off.
    await row.getByLabel("Add or remove stock for Black M").fill("abc");
    await expect(row.getByRole("button", { name: "Apply" })).toBeDisabled();

    // Customers see it; taking it off sale hides it again.
    await page.goto(productPath);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();
    await page.goto(`/admin/products?q=${encodeURIComponent(productName)}`);
    await card.getByRole("button", { name: "Take off sale" }).click();
    await expect(card).toContainText("Draft (hidden)");
    expect((await page.request.get(`/api/v1/catalog${productPath.replace("/product/", "/products/")}`)).status()).toBe(404);
    await card.getByRole("button", { name: "Put on sale" }).click();
    await expect(card).toContainText("On sale");
  });

  test("offers: create a code, edit it, switch it off and on, and a customer uses it at checkout", async ({ page, browser }) => {
    await signInAsOwner(page, "/admin/promotions");
    const form = page.getByRole("region", { name: "New offer" });

    await expect(form.getByRole("button", { name: "Create and switch on" })).toBeDisabled();
    await form.getByLabel("Name customers see (English)").fill("E2E welcome");
    await form.getByLabel("Name customers see (Arabic)").fill("ترحيب تجريبي");
    await form.getByLabel("Percent (1–90)").fill("95");
    await form.getByLabel("Code (letters, numbers, dashes)").fill(promoCode);
    await form.getByRole("button", { name: "Create and switch on" }).click();
    await expect(form.getByRole("alert")).toContainText("between 1 and 90");
    await form.getByLabel("Percent (1–90)").fill("10");
    await form.getByRole("button", { name: "Create and switch on" }).click();

    const offer = page.locator("main li", { hasText: promoCode });
    await expect(offer).toContainText("10% off on everything");
    await expect(offer).toContainText("used 0 times");

    // Edit: 10% becomes 15%. The code text itself is locked.
    await offer.getByRole("button", { name: "Edit" }).click();
    await expect(offer.getByLabel("Code (cannot be changed)")).toHaveAttribute("readonly", "");
    await offer.getByLabel("Percent (1–90)").fill("15");
    await offer.getByRole("button", { name: "Save changes" }).click();
    await expect(offer).toContainText("15% off on everything");

    // Switched off, the code is refused at checkout; switched on, it works.
    await offer.getByRole("button", { name: "Switch off" }).click();
    await expect(offer.getByRole("button", { name: "Switch on" })).toBeVisible();

    const customer = await newVisitor(browser);
    await addToBag(customer, productPath, "M");
    await registerCustomer(customer, "/checkout");
    await customer.getByLabel("Governorate").selectOption({ label: "Cairo" });
    await customer.getByLabel("Promo code").fill(promoCode);
    await customer.getByRole("button", { name: "Apply" }).click();
    await expect(customer.getByText("This code is not active.")).toBeVisible();
    await customer.getByRole("button", { name: "Remove" }).click();

    await offer.getByRole("button", { name: "Switch on" }).click();
    await expect(offer.getByRole("button", { name: "Switch off" })).toBeVisible();

    // 1,500 − 15% = 1,275, + 60 delivery = 1,335.
    const reference = await placeOrder(customer, /Cash on delivery/, promoCode);
    await expect(customer.getByText("−EGP 225")).toBeVisible();
    await expect(customer.getByText("EGP 1,335")).toBeVisible();

    await page.reload();
    await expect(page.locator("main li", { hasText: promoCode })).toContainText("used 1 times");

    // Cancelling gives the code back and frees the stock.
    await customer.getByRole("button", { name: "Cancel order" }).click();
    await customer.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(customer.getByRole("button", { name: "Undo cancel" })).toBeVisible();
    await page.reload();
    await expect(page.locator("main li", { hasText: promoCode })).toContainText("used 0 times");
    expect(reference).toMatch(/^LP-\d+$/);
    await customer.context().close();
  });

  test("content: home headline, footer contact, questions, and policy publish / take down", async ({ page }) => {
    await signInAsOwner(page, "/admin/content");

    // Home headline shows on the storefront; clearing it brings the brand line back.
    const hero = section(page, "Home page headline");
    await hero.getByLabel("Headline (English)").fill("E2E headline");
    await hero.getByRole("button", { name: "Save" }).click();
    await expect(hero.getByRole("status")).toContainText("Saved.");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E headline");
    await page.goto("/admin/content");
    await hero.getByLabel("Headline (English)").fill("");
    await hero.getByRole("button", { name: "Save" }).click();
    await expect(hero.getByRole("status")).toContainText("Saved.");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Steal the look.");

    // Footer contact.
    await page.goto("/admin/content");
    const contact = section(page, "Contact details in the footer");
    await contact.getByLabel("Phone").fill("01000000000");
    await contact.getByLabel("Instagram link").fill("javascript:alert(1)"); // not an https link: must never become a link
    await contact.getByRole("button", { name: "Save" }).click();
    await expect(contact.getByRole("status")).toContainText("Saved.");
    await page.goto("/");
    await expect(page.locator("footer").getByRole("link", { name: "01000000000" })).toBeVisible();
    await expect(page.locator("footer").getByRole("link", { name: "Instagram" })).toHaveCount(0);
    await page.goto("/admin/content");
    await contact.getByLabel("Phone").fill("");
    await contact.getByLabel("Instagram link").fill("");
    await contact.getByRole("button", { name: "Save" }).click();
    await expect(contact.getByRole("status")).toContainText("Saved.");

    // Questions: add, edit, hide, delete.
    const question = `E2E question ${Date.now()}`;
    await expect(page.locator("#qen-new").locator("xpath=ancestor::form").getByRole("button", { name: "Add question" })).toBeDisabled();
    await page.locator("#qen-new").fill(question);
    await page.locator("#qar-new").fill("سؤال تجريبي");
    await page.locator("#aen-new").fill("E2E answer.");
    await page.locator("#aar-new").fill("إجابة تجريبية.");
    await page.locator("#qen-new").locator("xpath=ancestor::form").getByRole("button", { name: "Add question" }).click();
    // The saved row has a "Save" button; the add form (which briefly holds the same text) does not.
    const saved = page.locator("form", { has: page.locator(`input[value="${question}"]`) })
      .filter({ has: page.getByRole("button", { name: "Save", exact: true }) });
    await expect(saved).toBeVisible();
    await page.goto("/faq");
    await page.getByText(question).click();
    await expect(page.getByText("E2E answer.")).toBeVisible();

    await page.goto("/admin/content");
    await saved.getByLabel("Answer (English)").fill("E2E answer, edited.");
    await saved.getByRole("button", { name: "Save" }).click();
    await expect(saved.getByRole("status")).toHaveText("Saved.");
    await page.goto("/faq");
    await page.getByText(question).click();
    await expect(page.getByText("E2E answer, edited.")).toBeVisible();

    await page.goto("/admin/content");
    await saved.getByRole("checkbox", { name: "Shown to customers" }).uncheck();
    await saved.getByRole("button", { name: "Save" }).click();
    await expect(saved.getByRole("status")).toHaveText("Saved.");
    await page.goto("/faq");
    await expect(page.getByText(question)).toHaveCount(0);

    await page.goto("/admin/content");
    await saved.getByRole("button", { name: "Delete" }).click();
    await saved.getByRole("button", { name: "Keep" }).click(); // changed my mind
    await expect(saved).toBeVisible();
    await saved.getByRole("button", { name: "Delete" }).click();
    await saved.getByRole("button", { name: "Yes, delete it" }).click();
    await expect(page.locator(`input[value="${question}"]`)).toHaveCount(0);

    // Policy: a draft is hidden, publishing shows it with a footer link, taking it down hides it.
    const policy = page.locator("details", { has: page.locator("#ben-privacy") });
    await policy.locator("summary").click();
    await expect(policy.getByRole("button", { name: "Save and publish" })).toBeDisabled(); // empty text
    await page.locator("#ben-privacy").fill("E2E privacy text.\n\nSecond paragraph.");
    await page.locator("#bar-privacy").fill("نص خصوصية تجريبي.");
    await policy.getByRole("button", { name: "Save draft" }).click();
    await expect(policy.getByRole("status")).toHaveText("Saved.");
    expect((await page.request.get("/api/v1/content/policies/privacy")).status()).toBe(404);

    await policy.getByRole("button", { name: "Save and publish" }).click();
    await expect(policy.locator("summary")).toContainText("Customers can read it");
    await page.goto("/policies/privacy");
    await expect(page.getByText("E2E privacy text.")).toBeVisible();
    await expect(page.locator("footer").getByRole("link", { name: "Privacy" })).toBeVisible();
    await page.goto("/ar/policies/privacy");
    await expect(page.getByText("نص خصوصية تجريبي.")).toBeVisible();

    await page.goto("/admin/content");
    await policy.locator("summary").click();
    await policy.getByRole("button", { name: "Take down" }).click();
    await expect(policy.locator("summary")).toContainText("Draft, hidden");
    expect((await page.request.get("/api/v1/content/policies/privacy")).status()).toBe(404);
  });

  test("settings: delivery options, payment methods, checkout rules and the announcement bar", async ({ page }) => {
    await signInAsOwner(page, "/admin/settings");
    const options = async () =>
      (await (await page.request.get("/api/v1/delivery/options?governorateId=1")).json()) as { nameEn: string; fee: number }[];
    const site = async () => (await page.request.get("/api/v1/content/site")).json();

    // Delivery: add an option, change its fee, hide it.
    const optionName = `E2E pickup ${Date.now().toString().slice(-6)}`;
    await page.locator("#en-new").fill(optionName);
    await page.locator("#ar-new").fill("استلام تجريبي");
    await page.locator("#fee-new").fill("25");
    const addForm = page.locator("form", { has: page.locator("#en-new") });
    await addForm.getByRole("checkbox", { name: "Shown to customers" }).check();
    await addForm.getByRole("button", { name: "Add delivery option" }).click();
    const option = page.locator("form", { has: page.locator(`input[value="${optionName}"]`) })
      .filter({ has: page.getByRole("button", { name: "Save", exact: true }) });
    await expect(option).toBeVisible();
    expect((await options()).find((o) => o.nameEn === optionName)?.fee).toBe(25);

    await option.getByLabel("Fee (EGP)").fill("40");
    await option.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await options()).find((o) => o.nameEn === optionName)?.fee).toBe(40);

    // Limit it to Giza only: Cairo customers no longer see it.
    await option.locator("summary").click();
    await option.getByRole("checkbox", { name: "Giza" }).check();
    await option.getByRole("button", { name: "Save" }).click();
    await expect(option.locator("summary")).toContainText("1 governorate(s) only");
    await expect.poll(async () => (await options()).some((o) => o.nameEn === optionName)).toBe(false);
    const inGiza = async () =>
      ((await (await page.request.get("/api/v1/delivery/options?governorateId=2")).json()) as { nameEn: string }[])
        .some((o) => o.nameEn === optionName);
    expect(await inGiza()).toBe(true);

    await option.getByRole("checkbox", { name: "Shown to customers" }).uncheck();
    await option.getByRole("button", { name: "Save" }).click();
    await expect.poll(inGiza).toBe(false);

    // Payment methods: cash off, then on again.
    const payment = section(page, "Payment methods");
    await payment.getByRole("checkbox", { name: /Cash on delivery/ }).uncheck();
    await payment.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await site()).paymentMethods.COD).toBe(false);
    await payment.getByRole("checkbox", { name: /Cash on delivery/ }).check();
    await payment.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await site()).paymentMethods.COD).toBe(true);
    // Card is switched on but Paymob is not set up: the screen says customers cannot use it.
    await payment.getByRole("checkbox", { name: /^Card/ }).check();
    await payment.getByRole("button", { name: "Save" }).click();
    await expect(payment.getByText(/customers cannot use it: Paymob is not set up/)).toBeVisible();
    expect((await site()).paymentMethods.CARD).toBe(false);
    await payment.getByRole("checkbox", { name: /^Card/ }).uncheck();
    await payment.getByRole("button", { name: "Save" }).click();
    // InstaPay cannot stay on without an address.
    await payment.getByLabel("InstaPay address customers send money to").fill("");
    await payment.getByRole("button", { name: "Save" }).click();
    await expect(payment.getByRole("alert")).toContainText("InstaPay address");
    await payment.getByLabel("InstaPay address customers send money to").fill("demo-not-real@instapay");
    await payment.getByRole("button", { name: "Save" }).click();
    await expect(payment.getByRole("status")).toHaveText("Saved.");

    // Checkout rules: free delivery threshold, with a nonsense value refused.
    const rules = section(page, "Checkout rules");
    await rules.getByLabel("Minutes a customer can undo a cancel").fill("999999");
    await rules.getByRole("button", { name: "Save" }).click();
    await expect(rules.getByRole("alert")).toContainText("cancelUndoMinutes");
    await rules.getByLabel("Minutes a customer can undo a cancel").fill("30");
    await rules.getByLabel("Free delivery from (EGP, empty = never)").fill("5000");
    await rules.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await site()).freeDeliveryThreshold).toBe(5000);
    await rules.getByLabel("Free delivery from (EGP, empty = never)").fill("");
    await rules.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await site()).freeDeliveryThreshold ?? null).toBeNull();

    // Announcement bar.
    const bar = section(page, "Announcement bar");
    await bar.getByLabel("English, one message per line").fill("E2E announcement");
    await bar.getByLabel("Arabic, one message per line").fill("إعلان تجريبي");
    await bar.getByRole("button", { name: "Save" }).click();
    await expect(bar.getByRole("status")).toHaveText("Saved.");
    await page.goto("/");
    await expect(page.getByText("E2E announcement")).toBeVisible();
    await page.goto("/ar");
    await expect(page.getByText("إعلان تجريبي")).toBeVisible();
    await page.goto("/admin/settings");
    await bar.getByLabel("English, one message per line").fill("");
    await bar.getByLabel("Arabic, one message per line").fill("");
    await bar.getByRole("button", { name: "Save" }).click();
    await expect(bar.getByRole("status")).toHaveText("Saved.");
    await page.goto("/");
    await expect(page.getByText("E2E announcement")).toHaveCount(0);
  });

  test("orders: search, filter, every step from new to delivered, and stock leaves on shipment", async ({ page, browser }) => {
    const customer = await newVisitor(browser);
    await addToBag(customer, productPath, "L");
    await registerCustomer(customer, "/checkout");
    const reference = await placeOrder(customer, /Cash on delivery/);

    await signInAsOwner(page, "/admin");
    // Search finds it by reference and by phone; nonsense finds nothing; Clear resets.
    await page.getByLabel("Reference, phone or name").fill(reference);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr")).toContainText("New (cash)");
    await page.getByLabel("Reference, phone or name").fill("no-such-order-xyz");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText("No orders match.")).toBeVisible();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible();
    // The status tiles filter the list.
    await page.getByRole("button", { name: /New \(cash\)/ }).click();
    await expect(page).toHaveURL(/status=PENDING/);
    await expect(page.locator("tbody tr", { hasText: reference })).toBeVisible();
    await page.getByLabel("Status").selectOption("DELIVERED");
    await expect(page.locator("tbody tr", { hasText: reference })).toHaveCount(0);

    await page.goto(`/admin/orders/${reference}`);
    await expect(page.getByRole("heading", { name: reference })).toBeVisible();
    await expect(page.getByText(`1 × ${productName}`)).toBeVisible();

    // "Back" leaves the order untouched.
    await page.getByRole("button", { name: "Confirm order" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("button", { name: "Confirm order" })).toBeVisible();

    await page.getByRole("button", { name: "Confirm order" }).click();
    await page.getByLabel("Note for staff (optional)").fill("Phoned the customer");
    await page.getByRole("button", { name: "Yes, do it" }).click();
    await expect(page.getByRole("button", { name: "Start preparing" })).toBeVisible();
    await expect(page.getByText("Phoned the customer")).toBeVisible();

    // The customer sees the new status and can no longer cancel once it is being prepared.
    await page.getByRole("button", { name: "Start preparing" }).click();
    await page.getByRole("button", { name: "Yes, do it" }).click();
    await expect(page.getByRole("button", { name: "Mark as shipped" })).toBeVisible();
    await customer.reload();
    await expect(customer.getByText("Being prepared").first()).toBeVisible();
    await expect(customer.getByRole("button", { name: "Cancel order" })).toHaveCount(0);

    await page.getByRole("button", { name: "Mark as shipped" }).click();
    await expect(page.getByText("The items leave the stock count now.")).toBeVisible();
    await page.getByLabel("Courier (optional)").fill("E2E Courier");
    await page.getByLabel("Tracking number (optional)").fill("TRK-E2E-1");
    await page.getByRole("button", { name: "Yes, do it" }).click();
    await expect(page.getByText("E2E Courier · TRK-E2E-1")).toBeVisible();
    // After shipping there is no cancel button any more.
    await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0);

    await page.getByRole("button", { name: "Mark as delivered" }).click();
    await expect(page.getByText(/This records EGP [\d,]+ cash as collected\./)).toBeVisible();
    await page.getByRole("button", { name: "Yes, do it" }).click();
    await expect(page.getByText("Nothing more to do on this order.")).toBeVisible();
    await expect(page.getByText("Cash on delivery · Paid")).toBeVisible();

    // Stock: 5 made, 1 shipped → 4 in the warehouse, nothing reserved.
    await page.goto(`/admin/products?q=${encodeURIComponent(productName)}`);
    const row = page.locator("main li", { hasText: productName }).locator("tbody tr", { hasText: "Black · L" });
    await expect(row.locator("td").nth(0)).toHaveText("4");
    await expect(row.locator("td").nth(1)).toHaveText("0");

    await customer.reload();
    await expect(customer.getByText("Delivered").first()).toBeVisible();
    await customer.context().close();
  });

  test("transfers and refunds: reject, confirm, cancel a paid order, record the refund", async ({ page, browser }) => {
    const customer = await newVisitor(browser);
    await addToBag(customer, productPath, "L");
    await registerCustomer(customer, "/checkout");
    const reference = await placeOrder(customer, /InstaPay transfer/);
    await expect(customer.getByText("demo-not-real@instapay")).toBeVisible();

    // A reference that is too short is caught on the page.
    await customer.getByRole("button", { name: "I have sent it" }).click();
    await expect(customer.getByText("Enter the reference number from your banking app.")).toBeVisible();
    await customer.getByLabel("Transfer reference number").fill("E2E REF 111");
    await customer.getByRole("button", { name: "I have sent it" }).click();
    await expect(customer.getByText(/We are checking your transfer \(reference E2E REF 111\)/)).toBeVisible();

    await signInAsOwner(page, "/admin/transfers");
    const transfer = page.locator("main li", { hasText: reference });
    await expect(transfer).toContainText("E2E REF 111");
    // Back out of the question, then reject.
    await transfer.getByRole("button", { name: "Not received" }).click();
    await transfer.getByRole("button", { name: "Back" }).click();
    await transfer.getByRole("button", { name: "Not received" }).click();
    await transfer.getByRole("button", { name: "Yes, reject" }).click();
    await expect(page.locator("main li", { hasText: reference })).toHaveCount(0);

    await customer.reload();
    await expect(customer.getByText("We could not find that transfer.")).toBeVisible();
    await customer.getByLabel("Transfer reference number").fill("E2E REF 222");
    await customer.getByRole("button", { name: "I have sent it" }).click();
    await expect(customer.getByText(/reference E2E REF 222/)).toBeVisible();

    await page.reload();
    await expect(transfer).toContainText("E2E REF 222");
    await transfer.getByRole("button", { name: "Money received" }).click();
    await expect(transfer.getByText(/Is EGP [\d,]+ in the account\?/)).toBeVisible();
    await transfer.getByRole("button", { name: "Yes, mark paid" }).click();
    await expect(page.getByText("Nothing to check right now.")).toBeVisible();

    await customer.reload();
    await expect(customer.getByText("Paid").first()).toBeVisible();
    await expect(customer.getByRole("button", { name: "Cancel order" })).toHaveCount(0); // paid orders are not self-cancelled

    // Staff cancel the paid order: it now needs a refund, which the owner records.
    await page.goto(`/admin/orders/${reference}`);
    await page.getByRole("button", { name: "Cancel order" }).click();
    await expect(page.getByText("The customer has paid and will need a refund.")).toBeVisible();
    await page.getByRole("button", { name: "Yes, do it" }).click();
    await expect(page.getByText(/must be refunded EGP [\d,]+ by hand/)).toBeVisible();
    await page.goto("/admin");
    await expect(page.getByText(/order\(s\) have money to refund/)).toBeVisible();

    await page.goto(`/admin/orders/${reference}`);
    await page.getByRole("button", { name: "Refund has been made" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Refund has been made" }).click();
    await page.getByRole("button", { name: "Yes, refund is done" }).click();
    await expect(page.getByText("The customer has been refunded.")).toBeVisible();
    await customer.context().close();
  });

  test("staff accounts: the owner adds an admin, the admin's limits hold, and switching off locks them out", async ({ page, browser }) => {
    const adminEmail = `${unique("e2e-admin")}@example.test`;
    const adminPassword = "e2e-admin-password-1";
    await signInAsOwner(page, "/admin/staff");

    // The owner cannot switch themselves off: their row has no buttons.
    const me = page.locator("main li", { hasText: "(you)" });
    await expect(me.getByRole("button")).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Add staff member" })).toBeDisabled();
    await page.getByLabel("Full name").fill("E2E Admin");
    await page.getByLabel("Email they will sign in with").fill(adminEmail);
    await page.getByLabel("First password (12+ characters)").fill("short");
    await expect(page.getByRole("button", { name: "Add staff member" })).toBeDisabled();
    await page.getByLabel("First password (12+ characters)").fill(adminPassword);
    await page.getByRole("button", { name: "Add staff member" }).click();
    const person = page.locator("main li", { hasText: adminEmail });
    await expect(person).toContainText("Admin: daily work");
    await expect(person).toContainText("never signed in");

    // The admin signs in and lands on the dashboard, with the owner-only parts closed.
    const staff = await newVisitor(browser);
    await signIn(staff, adminEmail, adminPassword);
    await expect(staff).toHaveURL(/\/admin$/);
    await expect(staff.getByRole("navigation", { name: "Dashboard" }).getByRole("link", { name: "Staff" })).toHaveCount(0);
    await staff.goto("/admin/staff");
    await expect(staff.getByText("Only the owner can add or switch off staff accounts.")).toBeVisible();
    await staff.goto("/admin/settings");
    await expect(staff.getByText("Only the owner can change payment settings.")).toBeVisible();
    await expect(staff.getByRole("checkbox", { name: /Cash on delivery/ })).toBeDisabled();
    await expect(staff.getByText("Only the owner can change these.")).toBeVisible();
    // Delivery fees are theirs to edit.
    await expect(staff.getByRole("button", { name: "Add delivery option" })).toBeVisible();
    await staff.goto("/admin/content");
    const terms = staff.locator("details", { has: staff.locator("#ben-terms") });
    await terms.locator("summary").click();
    await expect(terms.getByText("The owner publishes policies.")).toBeVisible();
    await expect(terms.getByRole("button", { name: "Save draft" })).toBeVisible(); // drafts are theirs to write
    await expect(staff.getByRole("button", { name: "Save and publish" })).toHaveCount(0);
    // The server agrees, whatever the screen shows.
    expect((await staff.request.get("/api/v1/admin/staff")).status()).toBe(403);
    expect((await staff.request.get("/api/v1/admin/orders")).status()).toBe(200);

    // Owner sets a new password: the admin's session ends, the old password stops working.
    await person.getByRole("button", { name: "Set new password" }).click();
    await person.getByLabel(/New password for E2E Admin/).fill("e2e-admin-password-2");
    await person.getByRole("button", { name: "Save password" }).click();
    await expect(person.getByRole("status")).toHaveText("Password changed.");
    await staff.goto("/admin");
    await expect(staff).toHaveURL(/\/sign-in/);
    await signIn(staff, adminEmail, adminPassword);
    await expect(staff.getByRole("alert")).toContainText("Email or password is not correct.");
    await signIn(staff, adminEmail, "e2e-admin-password-2");
    await expect(staff).toHaveURL(/\/admin$/);

    // Switched off: locked out at once, even though their browser still holds a session.
    await person.getByRole("button", { name: "Switch off" }).click();
    await person.getByRole("button", { name: "Back" }).click();
    await person.getByRole("button", { name: "Switch off" }).click();
    await person.getByRole("button", { name: "Yes, switch off" }).click();
    await expect(person).toContainText("Switched off");
    expect((await staff.request.get("/api/v1/admin/orders")).status()).toBe(401);
    await signIn(staff, adminEmail, "e2e-admin-password-2");
    await expect(staff.getByRole("alert")).toContainText("Email or password is not correct.");

    await person.getByRole("button", { name: "Switch on" }).click();
    await expect(person).toContainText("Can sign in");
    await signIn(staff, adminEmail, "e2e-admin-password-2");
    await expect(staff).toHaveURL(/\/admin$/);
    await staff.context().close();
  });

  test("a customer changes their password from the account page", async ({ page }) => {
    const email = await registerCustomer(page);
    await expect(page.getByRole("link", { name: "Open the staff dashboard" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled();

    await page.getByLabel("Current password").fill("not-the-password");
    await page.getByLabel("New password").fill("a-brand-new-password");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("alert")).toHaveText("Your current password is not correct.");

    await page.getByLabel("Current password").fill(CUSTOMER_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page).toHaveURL(/\/sign-in\?changed=1/);
    await expect(page.getByText("Password changed. Sign in with your new password.")).toBeVisible();

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(CUSTOMER_PASSWORD);
    await page.locator("form button[type=submit]").click();
    await expect(page.getByRole("alert")).toContainText("Email or password is not correct.");
    await page.getByLabel("Password").fill("a-brand-new-password");
    await page.locator("form button[type=submit]").click();
    await expect(page).toHaveURL(/\/account$/);
  });
});
