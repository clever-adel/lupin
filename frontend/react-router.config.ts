import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  future: {
    // Required by the Cloudflare Vite plugin: the server build runs inside workerd in dev too.
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
