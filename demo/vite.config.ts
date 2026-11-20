import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the built demo runs from any folder or static host.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5190 },
});
