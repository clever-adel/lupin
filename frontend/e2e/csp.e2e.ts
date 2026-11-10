import { expect, test } from "@playwright/test";

/**
 * The Content-Security-Policy is only enforced on built output. Run against `npm run build` +
 * `npx vite preview --port 4173`:  E2E_PREVIEW_URL=http://localhost:4173 npx playwright test csp
 */
const previewUrl = process.env.E2E_PREVIEW_URL;

test("the production build runs under the strict script policy with no violations", async ({ page }) => {
  test.skip(!previewUrl, "Set E2E_PREVIEW_URL to a served production build.");
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));

  const response = await page.goto(`${previewUrl}/`);
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
  expect(policy).not.toContain("'unsafe-inline' 'self'");
  expect(policy.split(";").find((part) => part.trim().startsWith("script-src"))).not.toContain("unsafe");

  // The page must actually hydrate and work: pick a size and add to the bag (client-side JavaScript).
  await page.goto(`${previewUrl}/product/demo-nightfall-bomber`);
  await page.getByRole("button", { name: "L", exact: true }).click();
  await page.getByRole("button", { name: /Add to bag/ }).click();
  await expect(page.getByText("Added to your bag.")).toBeVisible();

  // A second request gets a different nonce.
  const again = await page.goto(`${previewUrl}/ar`);
  expect(again?.headers()["content-security-policy"]).not.toBe(policy);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  // The brand fonts are served by this site (no third-party font host) and actually load.
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""));
    return {
      loaded,
      arabicHeading: getComputedStyle(document.querySelector("h1") as Element).fontFamily,
      thirdParty: performance.getEntriesByType("resource").map((r) => r.name).filter((u) => !u.startsWith(location.origin)),
    };
  });
  expect(fonts.loaded).toContain("IBM Plex Sans Arabic");
  expect(fonts.loaded).toContain("Archivo Variable");
  expect(fonts.arabicHeading).toContain("IBM Plex Sans Arabic");
  expect(fonts.thirdParty).toEqual([]);
  await page.screenshot({ path: "test-results/preview-ar.png" });
  await page.goto(`${previewUrl}/`);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('32px "Michroma"'))).toBe(true);
  await page.screenshot({ path: "test-results/preview-en.png" });

  expect(problems.filter((p) => /Content Security Policy|Refused to/i.test(p))).toEqual([]);
});
