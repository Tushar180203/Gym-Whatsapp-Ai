import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/index.js";
let app: PostgresVerticalSliceApp, token: string, exerciseId: string, workoutId: string;
test.beforeEach(async ({ context }) => {
  const url = process.env.TEST_DATABASE_URL!;
  const admin = new Pool({ connectionString: url }); await admin.query("drop schema if exists us6_web_test cascade"); await admin.query("create schema us6_web_test"); await admin.end();
  const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=us6_web_test");
  app = new PostgresVerticalSliceApp({ connectionString: parsed.toString() }); await app.migrate();
  const auth = await app.signUp("us6-browser@example.com", "correct horse battery staple"); token = auth.sessionToken;
  await app.setPreferredWeightUnit(auth.userId, "LB"); await app.createRoutine(auth.userId);
  let next = 0;
  async function send(text: string) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: "us6-web" }, messages: [{ id: `web-${next++}`, from: "15555550999", text: { body: text } }] } }] }] });
    const adapter = new WhatsAppInboundAdapter("us6-web-secret"); await app.processInbound(adapter.normalize(raw, adapter.sign(raw))[0]!);
  }
  await send(`link ${await app.createLinkToken(auth.userId)}`); await send("start");
  workoutId = (await app.activeWorkout(auth.userId))!.id;
  await send("45 lb x 10,45 lb x 9,45 lb x 8"); await send("done");
  exerciseId = (await app.pool.query("select exercise_identity_id from workout_sets where workout_session_id=$1 limit 1", [workoutId])).rows[0].exercise_identity_id;
  await app.classifyExercise(token, exerciseId, { classifications: [{ muscleGroup: "Chest", role: "PRIMARY", status: "CONFIRMED" }] });
  await context.addCookies([{ name: "workout_session", value: token, url: "http://127.0.0.1:3107", httpOnly: true, sameSite: "Lax" }]);
});
test.afterEach(async () => { await app?.close(); });
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`history and analytics review at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.goto("/history");
    await expect(page.getByRole("heading", { name: "Workout History" })).toBeVisible();
    await page.getByRole("link", { name: "Incomplete", exact: true }).click(); await expect(page.getByText("No saved workouts.")).toBeVisible();
    await page.getByRole("link", { name: "Completed", exact: true }).click();
    await page.locator(`a[href='/history/${workoutId}']`).click(); await expect(page.getByText("45 LB each x 10", { exact: false }).first()).toBeVisible();
    await page.getByRole("link", { name: "Analytics", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Workout Frequency" })).toBeVisible();
    await expect(page.locator(".metric-strip dd")).toHaveText(["1", "1", "3"]);
    await page.screenshot({ path: `/tmp/us6-overview-${viewport.width}.png`, fullPage: true });
    await page.getByRole("tab", { name: "Muscles", exact: true }).click(); await expect(page.getByRole("row", { name: /Chest 3/ })).toBeVisible();
    await page.getByLabel("Classification status").selectOption("UNCERTAIN"); await page.getByRole("button", { name: "Save classification" }).click();
    await expect(page.getByText("No confirmed primary-muscle records.")).toBeVisible();
    await page.getByLabel("Classification status").selectOption("CONFIRMED"); await page.getByRole("button", { name: "Save classification" }).click();
    await expect(page.getByRole("row", { name: /Chest 3/ })).toBeVisible();
    await page.screenshot({ path: `/tmp/us6-muscles-${viewport.width}.png`, fullPage: true });
    await page.getByRole("tab", { name: "Exercises", exact: true }).click(); await page.getByLabel("Progression exercise").selectOption(exerciseId);
    await expect(page.getByRole("table", { name: "Incline Dumbbell Press progression" }).locator("tbody tr")).toHaveCount(3);
    await expect(page.getByRole("cell", { name: "per hand per side", exact: true })).toHaveCount(3);
    await page.getByRole("button", { name: "Refresh analytics" }).click();
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(3);
    await page.screenshot({ path: `/tmp/us6-exercises-${viewport.width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.route("**/api/analytics/overview", route => route.fulfill({ status: 503 }));
    await page.getByRole("button", { name: "Refresh analytics" }).click(); await expect(page.getByRole("region", { name: "Workout analytics" }).getByRole("alert")).toContainText("Analytics unavailable");
  });
}
test("HTTP auth, owner, classification and empty-state boundaries", async ({ page, request, context }) => {
  expect((await request.get("/api/analytics/overview")).status()).toBe(401);
  const headers = { cookie: `workout_session=${token}` };
  expect((await request.get("/api/analytics/overview", { headers })).status()).toBe(200);
  expect((await request.get("/api/analytics/muscles", { headers })).status()).toBe(200);
  expect((await request.get(`/api/analytics/exercises/${exerciseId}`, { headers })).status()).toBe(200);
  expect((await request.get("/api/history/questions/supported", { headers })).status()).toBe(200);
  expect((await request.patch(`/api/exercises/${exerciseId}/classification`, { headers: { ...headers, origin: "https://foreign.example" }, data: { classifications: [] } })).status()).toBe(403);
  const other = await app.signUp("us6-empty@example.com", "correct horse battery staple"); await app.setPreferredWeightUnit(other.userId, "KG");
  expect((await request.get(`/api/analytics/exercises/${exerciseId}`, { headers: { cookie: `workout_session=${other.sessionToken}` } })).status()).toBe(404);
  await context.addCookies([{ name: "workout_session", value: other.sessionToken, url: "http://127.0.0.1:3107" }]);
  await page.goto("/analytics"); await expect(page.getByText("No completed workouts recorded.")).toBeVisible();
  await page.getByRole("tab", { name: "Muscles" }).click(); await expect(page.getByText("No confirmed primary-muscle records.")).toBeVisible();
  await page.goto("/history"); await expect(page.getByText("No saved workouts.")).toBeVisible();
  await app.logout(other.sessionToken); await page.goto("/analytics"); await expect(page.getByRole("alert")).toBeVisible();
});
