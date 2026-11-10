import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running stack. Start both first (see IMPLEMENTATION_STATUS.md):
 *   backend:  ./mvnw spring-boot:test-run "-Dspring-boot.run.main-class=store.lupinwear.LocalDevServer"
 *   frontend: npm run dev
 * They use the local demo data only and must never be pointed at production.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
