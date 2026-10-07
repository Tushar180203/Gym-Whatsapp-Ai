import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required for US5 HTTP acceptance");
const parsed = new URL(process.env.TEST_DATABASE_URL); parsed.searchParams.set("options", "-c search_path=us5_web_test");
export default defineConfig({
  testDir: ".", testMatch: "*.spec.ts", workers: 1, timeout: 60000,
  use: { baseURL: "http://127.0.0.1:3106" },
  webServer: { cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    command: "node node_modules/next/dist/bin/next dev apps/web --webpack --hostname 127.0.0.1 --port 3106",
    url: "http://127.0.0.1:3106", timeout: 120000,
    env: { DATABASE_URL: parsed.toString(), GEMINI_API_KEY: "offline-no-live-calls", AI_PROVIDER: "gemini", WHATSAPP_APP_SECRET: "us5-web-secret" }
  }
});
