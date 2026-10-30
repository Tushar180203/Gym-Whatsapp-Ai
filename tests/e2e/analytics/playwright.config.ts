import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".", testMatch: "analytics.spec.ts", workers: 1, timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3118" },
  webServer: {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    command: "node node_modules/vite/bin/vite.js tests/e2e/analytics --config tests/e2e/analytics/vite.config.ts --host 127.0.0.1 --port 3118 --strictPort",
    url: "http://127.0.0.1:3118", timeout: 30000
  }
});
