import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests run in jsdom without the Cloudflare / React Router plugins.
export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["app/**/*.test.{ts,tsx}"],
  },
});
