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
});
