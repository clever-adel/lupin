import { expect, test, type Page } from "@playwright/test";
import { newVisitor, ownerPassword, signInAsOwner } from "./helpers";

/**
 * Phone-size photos: an upload from the dashboard also stores WebP copies; the store serves the width it
 * is asked for, falls back to the original while a copy is missing, and the products page prepares
 * copies for photos uploaded without them.
 */
test.describe.serial("phone-size photos", () => {
  test.skip(!ownerPassword, "No local owner password (backend/.local-owner-password or E2E_OWNER_PASSWORD).");

  // One owner sign-in for both tests: the sign-in rate limit counts every attempt.
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await newVisitor(browser);
    await signInAsOwner(page, "/admin/products");
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  /** A real 1600×2000 JPEG drawn in the page, so the test needs no image file. */
  async function bigJpeg(page: Page): Promise<Buffer> {
    const base64 = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 2000;
      const context = canvas.getContext("2d")!;
      const gradient = context.createLinearGradient(0, 0, 1600, 2000);
      gradient.addColorStop(0, "#1b1b1b");
      gradient.addColorStop(1, "#c9b79c");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 1600, 2000);
      for (let i = 0; i < 400; i++) {
        context.fillStyle = `hsl(${i * 37 % 360} 40% 50%)`;
        context.fillRect((i * 97) % 1600, (i * 61) % 2000, 40, 40);
      }
      return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
    });
    return Buffer.from(base64, "base64");
  }

  async function fetchInfo(page: Page, url: string) {
    return page.evaluate(async (address) => {
      const response = await fetch(address, { cache: "no-store" });
      const body = await response.arrayBuffer();
      return { status: response.status, type: response.headers.get("Content-Type"), cache: response.headers.get("Cache-Control"), bytes: body.byteLength };
    }, url);
  }

  test("an upload from the dashboard stores WebP copies, and the store serves the size it is asked for", async () => {
    const products = await (await page.request.get("/api/v1/admin/products?page=0&q=")).json();
    await page.goto(`/admin/products/${products.items[0].id}`);
    const photo = await bigJpeg(page);

    const sizes = page.waitForResponse((r) => /\/media\/[^/]+\/sizes$/.test(r.url()));
    const upload = page.waitForResponse((r) => r.url().endsWith("/media/upload"));
    await page.locator('input[type="file"]').first().setInputFiles({ name: "big.jpg", mimeType: "image/jpeg", buffer: photo });
    const [uploaded] = await (await upload).json();
    expect((await sizes).status()).toBe(204);

    const original = await fetchInfo(page, uploaded.url);
    expect(original.type).toBe("image/jpeg");
    const small = await fetchInfo(page, `${uploaded.url}?w=480`);
    expect(small.type).toBe("image/webp");
    expect(small.cache).toContain("immutable");
    expect(small.bytes).toBeLessThan(original.bytes / 4);
    // A width that has no copy gets the original.
    expect((await fetchInfo(page, `${uploaded.url}?w=500`)).type).toBe("image/jpeg");

    // Removing the photo removes its copies too.
    const removed = await page.evaluate(async (key) => {
      const token = decodeURIComponent(document.cookie.split("; ").find((c) => c.startsWith("XSRF-TOKEN="))!.slice(11));
      return (await fetch(`/media/${key}`, { method: "DELETE", headers: { "X-XSRF-TOKEN": token } })).status;
    }, uploaded.publicId);
    expect(removed).toBe(204);
    expect((await fetchInfo(page, `${uploaded.url}?w=480`)).status).toBe(404);
  });

  test("a photo without copies still shows, and one click on the products page prepares it", async () => {
    await page.goto("/admin/products");
    const photo = await bigJpeg(page);
    // Uploaded the old way: no copies.
    const uploaded = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append("files", new File([bytes], "old.jpg", { type: "image/jpeg" }));
      const token = ((await (await fetch("/api/v1/auth/csrf")).json()) as { token: string }).token;
      const response = await fetch("/media/upload", { method: "POST", body: form, headers: { "X-XSRF-TOKEN": token } });
      return (await response.json())[0] as { url: string; publicId: string };
    }, photo.toString("base64"));

    const before = await fetchInfo(page, `${uploaded.url}?w=320`);
    expect(before.status).toBe(200);
    expect(before.type).toBe("image/jpeg"); // the original, while no copy exists
    expect(before.cache).not.toContain("immutable");

    await page.reload();
    const panel = page.getByRole("region", { name: "Phone-size photos" });
    await expect(panel).toContainText(/uploaded before smaller copies were made/);
    await panel.getByRole("button", { name: "Prepare phone-size photos" }).click();
    await expect(panel.getByRole("status")).toContainText(/Prepared (\d+) of \1 photos\./, { timeout: 60_000 });

    expect((await fetchInfo(page, `${uploaded.url}?w=320`)).type).toBe("image/webp");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Products & stock" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Phone-size photos" })).toHaveCount(0);
  });

  test("the owner uploads a wide photo for the Men card, the home page shows it, and it can go back", async () => {
    await page.goto("/admin/products");
    const departments = page.getByRole("region", { name: "Departments" });
    const photo = await bigJpeg(page);
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/admin/departments/men/photo"));
    await departments.locator("label", { hasText: /(Upload|Change) Men photo/ }).locator('input[type="file"]')
      .setInputFiles({ name: "men-card.jpg", mimeType: "image/jpeg", buffer: photo });
    expect((await saved).status()).toBe(200);
    await expect(departments).toContainText("Home page card: your photo.");
    const own = (await (await page.request.get("/api/v1/admin/departments")).json())
      .find((d: { slug: string }) => d.slug === "men").ownImageUrl as string;
    expect(own).toMatch(/^\/media\//);

    await page.goto("/");
    const card = page.locator(`a[href$="/men"] img`).first();
    await expect(card).toHaveAttribute("src", new RegExp(own.replace(/[.]/g, "\\.")));

    await page.goto("/admin/products");
    await departments.getByRole("button", { name: "Use the first piece's photo" }).click();
    await expect(departments).toContainText("Home page card: the first piece's photo.");
  });

  test("the Men card shows the first pieces' photos and moves by itself, on a phone and a computer", async ({ browser }) => {
    await page.goto("/admin/products");
    const photo = await bigJpeg(page);
    // Photos on two pieces, through the dashboard's own API.
    const placed = await page.evaluate(async ({ base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const token = ((await (await fetch("/api/v1/auth/csrf")).json()) as { token: string }).token;
      const send = (method: string, url: string, body?: unknown) => fetch(url, {
        method, headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const done: { productId: number; colorId: number }[] = [];
      for (const q of ["Nightfall", "Harbour"]) {
        const id = ((await (await fetch(`/api/v1/admin/products?page=0&q=${q}`)).json()) as { items: { id: number }[] }).items[0]!.id;
        const detail = (await (await fetch(`/api/v1/admin/products/${id}`)).json()) as { colors: { id: number; main: boolean }[] };
        const colorId = (detail.colors.find((c) => c.main) ?? detail.colors[0]!).id;
        const form = new FormData();
        form.append("files", new File([bytes], `${q}.jpg`, { type: "image/jpeg" }));
        const [uploaded] = (await (await fetch("/media/upload", { method: "POST", body: form, headers: { "X-XSRF-TOKEN": token } })).json()) as
          { url: string; publicId: string }[];
        await send("PUT", `/api/v1/admin/products/${id}/colors/${colorId}/images`,
          { images: [{ url: uploaded!.url, publicId: uploaded!.publicId, altEn: "", altAr: "" }] });
        done.push({ productId: id, colorId });
      }
      return done;
    }, { base64: photo.toString("base64") });

    // Phone: one photo at a time, moving on by itself.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const visitor = await phone.newPage();
    await visitor.addInitScript(() => window.sessionStorage.setItem("lupin.intro", "1"));
    await visitor.goto("/");
    await visitor.locator("html[data-hydrated]").waitFor({ state: "attached" });
    const card = visitor.locator('a[href$="/shop/men"]').filter({ has: visitor.locator("[data-card-slide]") });
    await expect(card.locator("[data-card-slide]")).toHaveCount(2);
    const firstOn = await card.locator('[data-card-slide="on"] img').getAttribute("src");
    await expect(card.locator('[data-card-slide="on"] img')).not.toHaveAttribute("src", firstOn!, { timeout: 8000 });
    await phone.close();

    // Computer: the pieces side by side across the card, gliding sideways.
    const computer = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const wide = await computer.newPage();
    await wide.addInitScript(() => window.sessionStorage.setItem("lupin.intro", "1"));
    await wide.goto("/");
    await wide.locator("html[data-hydrated]").waitFor({ state: "attached" });
    const strip = wide.locator('a[href$="/shop/men"] [data-card-strip]');
    await expect(strip).toBeVisible();
    expect(await strip.locator("img").count()).toBeGreaterThanOrEqual(16);
    const moved = async () => strip.locator(".card-strip").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
    const before = await moved();
    await wide.waitForTimeout(1500);
    expect(await moved()).not.toBe(before);
    await computer.close();

    await page.evaluate(async (pieces) => {
      const token = ((await (await fetch("/api/v1/auth/csrf")).json()) as { token: string }).token;
      for (const { productId, colorId } of pieces) {
        await fetch(`/api/v1/admin/products/${productId}/colors/${colorId}/images`, {
          method: "PUT", headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token }, body: JSON.stringify({ images: [] }),
        });
      }
    }, placed);
  });

  test("product photos zoom under the mouse and open full screen at full quality, on a computer and a phone", async ({ browser }) => {
    // Three photos on the main colour of a demo piece, saved through the dashboard's own API. Only the
    // first two (front and back) zoom.
    await page.goto("/admin/products");
    const photo = await bigJpeg(page);
    const list = await (await page.request.get("/api/v1/admin/products?page=0&q=Nightfall")).json();
    const id = list.items[0].id as number;
    const detail = await (await page.request.get(`/api/v1/admin/products/${id}`)).json();
    const colour = detail.colors.find((c: { main: boolean }) => c.main) ?? detail.colors[0];
    const saved = await page.evaluate(async ({ base64, productId, colorId }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const token = ((await (await fetch("/api/v1/auth/csrf")).json()) as { token: string }).token;
      const form = new FormData();
      form.append("files", new File([bytes], "a.jpg", { type: "image/jpeg" }));
      form.append("files", new File([bytes], "b.jpg", { type: "image/jpeg" }));
      form.append("files", new File([bytes], "c.jpg", { type: "image/jpeg" }));
      const uploaded = (await (await fetch("/media/upload", { method: "POST", body: form, headers: { "X-XSRF-TOKEN": token } })).json()) as
        { url: string; publicId: string }[];
      const put = await fetch(`/api/v1/admin/products/${productId}/colors/${colorId}/images`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token },
        body: JSON.stringify({ images: uploaded.map((u) => ({ url: u.url, publicId: u.publicId, altEn: "", altAr: "" })) }),
      });
      return { status: put.status, urls: uploaded.map((u) => u.url) };
    }, { base64: photo.toString("base64"), productId: id, colorId: colour.id });
    expect(saved.status).toBe(204);

    // Computer: resting the mouse on a photo shows the original, enlarged where the pointer is.
    await page.goto(`/product/${detail.slug}`);
    await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
    const first = page.locator("[data-gallery] li").first().getByRole("button");
    await expect(page.locator("[data-gallery] li").nth(1).getByRole("button")).toHaveCount(1);
    await expect(page.locator("[data-gallery] li").nth(2).getByRole("button")).toHaveCount(0);
    await expect(page.locator("[data-gallery] li").nth(2).locator("img")).toHaveCount(1);
    const box = (await first.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
    const layer = page.locator("[data-zoom-layer]");
    await expect(layer).toHaveAttribute("src", saved.urls[0]!);
    await expect(layer).toHaveAttribute("style", /scale\(2\.4\).*25%/);
    await page.mouse.move(box.x - 40, box.y - 40);
    await expect(layer).toHaveCount(0);

    // A click opens it full screen; arrows change photo; Escape closes.
    await first.click();
    const viewer = page.getByRole("dialog");
    await expect(viewer).toBeVisible();
    await expect(viewer.locator("img")).toHaveAttribute("src", saved.urls[0]!);
    await expect(viewer).toContainText("Photo 1 of 2");
    await viewer.getByRole("button", { name: "Next photo" }).click();
    await expect(viewer).toContainText("Photo 2 of 2");
    await viewer.getByRole("button", { name: "Next photo" }).click();
    await expect(viewer).toContainText("Photo 1 of 2");
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);

    // Phone: a tap opens the viewer, a double tap zooms in and another zooms back out.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const mobile = await phone.newPage();
    await mobile.addInitScript(() => window.sessionStorage.setItem("lupin.intro", "1"));
    await mobile.goto(`/product/${detail.slug}`);
    await mobile.locator("html[data-hydrated]").waitFor({ state: "attached" });
    await mobile.locator("[data-gallery] li").first().getByRole("button").tap();
    const mobileViewer = mobile.getByRole("dialog");
    await expect(mobileViewer).toBeVisible();
    const img = mobileViewer.locator("img");
    await expect(img).toHaveAttribute("src", saved.urls[0]!);
    const frame = (await mobileViewer.locator("div").first().boundingBox())!;
    const tapAt = async () => {
      await mobile.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2);
    };
    await tapAt();
    await mobile.waitForTimeout(80);
    await tapAt();
    await expect(img).toHaveAttribute("style", /scale\(2\.5\)/);
    await mobile.waitForTimeout(400);
    await tapAt();
    await mobile.waitForTimeout(80);
    await tapAt();
    await expect(img).toHaveAttribute("style", /scale\(1\)/);
    await mobileViewer.getByRole("button", { name: "Close" }).tap();
    await expect(mobileViewer).toHaveCount(0);
    await phone.close();

    // Put the demo piece back as it was.
    await page.evaluate(async ({ productId, colorId }) => {
      const token = ((await (await fetch("/api/v1/auth/csrf")).json()) as { token: string }).token;
      await fetch(`/api/v1/admin/products/${productId}/colors/${colorId}/images`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token },
        body: JSON.stringify({ images: [] }),
      });
    }, { productId: id, colorId: colour.id });
  });
});
