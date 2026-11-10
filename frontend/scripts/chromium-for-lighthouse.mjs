// Starts Playwright's Chromium with a debugging port so Lighthouse can attach to it:
//   node scripts/chromium-for-lighthouse.mjs            (keeps running; Ctrl+C to stop)
//   npx lighthouse http://localhost:4173/ --port=9222   (in another terminal, against `vite preview`)
import { chromium } from "@playwright/test";

const port = Number(process.env.LH_PORT ?? 9222);
const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
console.log(`Chromium ready for Lighthouse on port ${port}`);
process.on("SIGINT", async () => {
  await browser.close();
  process.exit(0);
});
await new Promise(() => {});
