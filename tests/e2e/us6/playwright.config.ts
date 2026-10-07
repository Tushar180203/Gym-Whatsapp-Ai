import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required for US6 browser acceptance");
const parsed = new URL(process.env.TEST_DATABASE_URL); parsed.searchParams.set("options", "-c search_path=us6_web_test");
export default defineConfig({
  testDir: "..", testMatch: "us6-history-analytics.spec.ts", workers: 1, timeout: 60000,
  use: { baseURL: "http://127.0.0.1:3107" },
  webServer: { cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    command: "node node_modules/next/dist/bin/next dev apps/web --webpack --hostname 127.0.0.1 --port 3107",
    url: "http://127.0.0.1:3107", timeout: 120000,
    env: { DATABASE_URL: parsed.toString(), GEMINI_API_KEY: "offline-no-live-calls", AI_PROVIDER: "gemini", WHATSAPP_APP_SECRET: "us6-web-secret" }
  }
});
