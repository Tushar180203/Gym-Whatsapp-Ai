import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required for the US4 web acceptance test");
const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=us4_web_test");
export default defineConfig({
  testDir: ".", testMatch: "*.spec.ts", workers: 1, timeout: 60000,
  use: { baseURL: "http://127.0.0.1:3104", launchOptions: { executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] } },
  webServer: {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    command: "node node_modules/next/dist/bin/next dev apps/web --webpack --hostname 127.0.0.1 --port 3104",
    url: "http://127.0.0.1:3104", timeout: 120000,
    env: { DATABASE_URL: parsed.toString(), GEMINI_API_KEY: "offline-test-no-live-calls", AI_PROVIDER: "gemini", WHATSAPP_APP_SECRET: "web-test-secret" }
  }
});
