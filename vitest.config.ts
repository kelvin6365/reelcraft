import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    // Secrets env.ts now requires (no more dev defaults). NODE_ENV=test so the
    // production guards (dev-secret / local-storage rejection) don't fire.
    env: {
      API_ENCRYPTION_KEY: process.env.API_ENCRYPTION_KEY ?? "test-encryption-key-16chars-min",
    },
  },
});
