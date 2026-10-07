import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../../packages/persistence/src/postgres.js";
import { WhatsAppInboundAdapter } from "../../../packages/messaging/src/index.js";

let app: PostgresVerticalSliceApp, sessionToken: string, workoutId: string, userId: string;
test.beforeEach(async ({ context }) => {
  const base = process.env.TEST_DATABASE_URL!;
  const admin = new Pool({ connectionString: base });
  await admin.query("drop schema if exists us4_web_test cascade"); await admin.query("create schema us4_web_test"); await admin.end();
  const parsed = new URL(base); parsed.searchParams.set("options", "-c search_path=us4_web_test");
  app = new PostgresVerticalSliceApp({ connectionString: parsed.toString() }); await app.migrate();
  const auth = await app.signUp("web@example.com", "correct horse battery staple");
  sessionToken = auth.sessionToken; userId = auth.userId;
  await app.setPreferredWeightUnit(userId, "LB"); await app.createRoutine(userId);
  let n = 0;
  for (const text of [`link ${await app.createLinkToken(userId)}`, "start", "start planned", "45x10,45x9", "finish", "save completed"]) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: "phone-web" }, messages: [{ id: `web-${n++}`, from: "15555550999", text: { body: text } }] } }] }] });
    const adapter = new WhatsAppInboundAdapter("web-test-secret"); await app.processInbound(adapter.normalize(raw, adapter.sign(raw))[0]!);
  }
  workoutId = (await app.history(userId))[0]!.workout.id;
  await context.addCookies([{ name: "workout_session", value: sessionToken, url: "http://127.0.0.1:3104", httpOnly: true, sameSite: "Strict" }]);
});
test.afterEach(async () => { await app?.close(); });
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`edits completed history durably at ${viewport.width}px with no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.goto(`/history/${workoutId}`);
    await expect(page.getByRole("heading", { name: "Upper" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recorded sets" })).toHaveAttribute("data-ready", "true");
    await page.getByLabel("Set 1 reps", { exact: true }).fill("12");
    await page.getByRole("button", { name: "Save set 1", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Set saved.");
    await page.reload(); await expect(page.getByRole("region", { name: "Recorded sets" })).toHaveAttribute("data-ready", "true"); await expect(page.getByLabel("Set 1 reps", { exact: true })).toHaveValue("12");
    const audit = await app.pool.query("select before_snapshot,after_snapshot,source_surface from corrections where source_surface='WEB'");
    expect(audit.rows).toHaveLength(1); expect(audit.rows[0]).toMatchObject({ before_snapshot: { reps: 10 }, after_snapshot: { reps: 12 }, source_surface: "WEB" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/us4-history-${viewport.width}.png`, fullPage: true });
  });
}
test("HTTP history editing enforces ownership, authenticated sessions and same-origin mutation", async ({ request }) => {
  const history = await app.historyDetails(sessionToken, workoutId);
  const path = `/api/workouts/${workoutId}/sets/${history.sets[0]!.id}`;
  const data = { replacement: { reps: 12 }, expectedVersion: history.workout.version, idempotencyKey: "web-isolation" };
  const other = await app.signUp("other@example.com", "correct horse battery staple");
  const denied = await request.patch(path, { data, headers: { cookie: `workout_session=${other.sessionToken}` } }); expect(denied.status()).toBe(404);
  const csrf = await request.patch(path, { data, headers: { origin: "https://untrusted.example", cookie: `workout_session=${sessionToken}` } }); expect(csrf.status()).toBe(403);
  const accepted = await request.patch(path, { data, headers: { cookie: `workout_session=${sessionToken}` } }); expect(accepted.status()).toBe(200);
  const duplicate = await request.patch(path, { data, headers: { cookie: `workout_session=${sessionToken}` } }); expect(duplicate.status()).toBe(200);
  const stale = await request.patch(path, { data: { ...data, idempotencyKey: "different", replacement: { reps: 13 } }, headers: { cookie: `workout_session=${sessionToken}` } }); expect(stale.status()).toBe(409);
  const current = await app.historyDetails(sessionToken, workoutId);
  const invalid = await request.patch(path, { data: { ...data, idempotencyKey: "invalid", expectedVersion: current.workout.version, replacement: { reps: -1 } }, headers: { cookie: `workout_session=${sessionToken}` } }); expect(invalid.status()).toBe(400);
  await app.logout(sessionToken);
  const expired = await request.patch(path, { data, headers: { cookie: `workout_session=${sessionToken}` } }); expect(expired.status()).toBe(401);
});
