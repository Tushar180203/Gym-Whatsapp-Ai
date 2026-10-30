import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
if (!process.env.TEST_DATABASE_URL) throw new Error("A disposable TEST_DATABASE_URL is required");
const parsed = new URL(process.env.TEST_DATABASE_URL); parsed.searchParams.set("options", "-c search_path=reminders_web_test");
export default defineConfig({ testDir: "..", testMatch: "workout-reminders.spec.ts", workers: 1, timeout: 60000,
  use: { baseURL: "http://127.0.0.1:3120" }, webServer: { cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    command: "node node_modules/next/dist/bin/next dev apps/web --webpack --hostname 127.0.0.1 --port 3120", url: "http://127.0.0.1:3120", timeout: 120000,
    env: { NEXT_TEST_DIST_DIR: ".next-reminder-tests", DATABASE_URL: parsed.toString(), GEMINI_API_KEY: "offline-no-live-calls", AI_PROVIDER: "gemini", WHATSAPP_APP_SECRET: "reminder-fixture", WHATSAPP_PROVIDER: "disabled", APP_ORIGIN: "http://127.0.0.1:3120" } } });
