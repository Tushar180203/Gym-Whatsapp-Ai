import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
test.beforeEach(async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const admin = new Pool({ connectionString: url }); await admin.query("drop schema if exists reminders_web_test cascade"); await admin.query("create schema reminders_web_test"); await admin.end();
  const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=reminders_web_test");
  const app = new PostgresVerticalSliceApp({ connectionString: parsed.toString() }); try { await app.migrate(); } finally { await app.close(); }
});
for (const width of [1280, 390]) test(`5 AM reminder preference persists and can be disabled at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  expect((await page.request.post("/api/auth/signup", { data: { email: `reminder-${width}@example.com`, password: "correct horse battery staple" } })).ok()).toBe(true);
  expect((await page.request.patch("/api/profile", { data: { preferredWeightUnit: "KG", timeZone: "Asia/Kolkata" } })).ok()).toBe(true);
  await page.goto("/routines"); await page.getByText("Profile & preferences", { exact: true }).click();
  const reminder = page.getByRole("checkbox", { name: "Send me a 5:00 AM workout reminder on WhatsApp" });
  await expect(reminder).not.toBeChecked();
  await expect(page.locator(".reminder-preference")).toContainText("5:00 AM in Asia/Kolkata");
  await expect(page.locator(".reminder-preference")).toContainText("After 24 hours");
  await reminder.check(); await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("Profile saved.");
  expect((await (await page.request.get("/api/profile")).json()).workoutRemindersEnabled).toBe(true);
  await page.reload(); await page.getByText("Profile & preferences", { exact: true }).click();
  await expect(reminder).toBeChecked();
  await page.screenshot({ path: `/tmp/workout-reminder-preferences-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reminder.uncheck(); await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("Profile saved.");
  expect((await (await page.request.get("/api/profile")).json()).workoutRemindersEnabled).toBe(false);
  expect((await page.request.patch("/api/profile", { data: { preferredWeightUnit: "KG", workoutRemindersEnabled: "yes" } })).status()).toBe(400);
});
