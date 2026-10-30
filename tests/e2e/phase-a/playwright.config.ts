import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required for Phase A acceptance");
const parsed = new URL(process.env.TEST_DATABASE_URL); parsed.searchParams.set("options", "-c search_path=phase_a_web_test");
export default defineConfig({ testDir: "..", testMatch: ["us1-onboarding-routine.spec.ts", "us2-workout-selection.spec.ts"], workers: 1, timeout: 90000,
  use: { baseURL: "http://127.0.0.1:3112" }, webServer: { cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    command: "node node_modules/next/dist/bin/next dev apps/web --webpack --hostname 127.0.0.1 --port 3112", url: "http://127.0.0.1:3112", timeout: 120000,
    env: { DATABASE_URL: parsed.toString(), GEMINI_API_KEY: "offline-no-live-calls", AI_PROVIDER: "gemini", WHATSAPP_APP_SECRET: "phase-a-secret", WHATSAPP_PROVIDER: "disabled", WHATSAPP_BUSINESS_NUMBER: "+15551234567", APP_ORIGIN: "http://127.0.0.1:3112" } } });
