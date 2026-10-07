import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/index.js";
let app: PostgresVerticalSliceApp, token: string, userId: string;
test.beforeEach(async ({ context }) => {
  const url = process.env.TEST_DATABASE_URL!; const admin = new Pool({ connectionString: url });
  await admin.query("drop schema if exists us7_web_test cascade"); await admin.query("create schema us7_web_test"); await admin.end();
  const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=us7_web_test");
  app = new PostgresVerticalSliceApp({ connectionString: parsed.toString() }); await app.migrate();
  const auth = await app.signUp("us7-browser@example.com", "correct horse battery staple"); token = auth.sessionToken; userId = auth.userId;
  await app.setPreferredWeightUnit(userId, "LB"); await app.createRoutine(userId); let next = 0;
  async function send(text: string) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: "us7-browser" }, messages: [{ id: `web-${next++}`, from: "15555550234", text: { body: text } }] } }] }] });
    const adapter = new WhatsAppInboundAdapter("us7-web-secret"); await app.processInbound(adapter.normalize(raw, adapter.sign(raw))[0]!);
  }
  await send(`link ${await app.createLinkToken(userId)}`); await send("start"); await send("45 lb x 10,45 lb x 9,45 lb x 8"); await send("done");
  await context.addCookies([{ name: "workout_session", value: token, url: "http://127.0.0.1:3108", httpOnly: true, sameSite: "Lax" }]);
});
test.afterEach(async () => { await app?.close(); });
for (const width of [1280, 390]) test(`review/export/confirmed workout deletion at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 }); await page.goto("/settings/data");
  await expect(page.getByRole("heading", { name: "Stored Data", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: "Workout sets 3" })).toBeVisible();
  await page.getByRole("button", { name: "Request export", exact: true }).click(); await expect(page.getByRole("link", { name: "Download export" })).toBeVisible();
  const download = page.waitForEvent("download"); await page.getByRole("link", { name: "Download export" }).click(); expect((await download).suggestedFilename()).toBe("workout-export.json");
  await page.getByRole("button", { name: "Check export status" }).click();
  await page.screenshot({ path: `/tmp/us7-data-${width}.png`, fullPage: true });
  await page.getByRole("button", { name: "Delete workout data", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible(); await expect(dialog.getByRole("button", { name: "Confirm deletion", exact: true })).toBeDisabled();
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Review confirmation" }).click(); await expect(dialog).toBeVisible();
  expect(await app.history(userId)).toHaveLength(1);
  await dialog.getByRole("checkbox").check(); await page.screenshot({ path: `/tmp/us7-confirm-${width}.png`, fullPage: true });
  await dialog.getByRole("button", { name: "Confirm deletion", exact: true }).click(); await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Deletion completed.", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: "Workout sets 0" })).toBeVisible(); await page.waitForLoadState("networkidle");
  await page.reload(); await expect(page.getByRole("row", { name: "Workout sets 0" })).toBeVisible();
  expect(await app.history(userId)).toHaveLength(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "History", exact: true }).first().click(); await expect(page.getByText("No saved workouts.")).toBeVisible();
});
test("account confirmation result, invalidated session and private API ownership", async ({ page, request }) => {
  expect((await request.post("/api/data/export", { data: { idempotencyKey: "anonymous" } })).status()).toBe(401);
  const other = await app.signUp("us7-foreign@example.com", "correct horse battery staple"); const headers = { cookie: `workout_session=${other.sessionToken}` };
  const exp = await app.requestExport(token, { idempotencyKey: "export" }); expect((await request.get(`/api/data/export/${exp.id}`, { headers })).status()).toBe(404);
  expect((await request.post("/api/data/delete-request", { headers, data: { type: "DELETE_ACCOUNT", idempotencyKey: "attack", userId } })).status()).toBe(400);
  await page.goto("/settings/data"); await page.getByRole("button", { name: "Delete account", exact: true }).click();
  const pending = (await app.dataReview(token)).requests.find(row => row.type === "DELETE_ACCOUNT")!;
  expect((await request.post(`/api/data/delete-request/${pending.id}/confirm`, { headers, data: { confirm: true } })).status()).toBe(404);
  expect((await request.post(`/api/data/delete-request/${pending.id}/confirm`, { headers: { cookie: `workout_session=${token}`, origin: "https://foreign.example" }, data: { confirm: true } })).status()).toBe(403);
  await page.getByRole("dialog").getByRole("checkbox").check(); await page.getByRole("button", { name: "Confirm deletion", exact: true }).click();
  await expect(page.getByText("Account deleted. Session invalidated.", { exact: true })).toBeVisible();
  expect((await request.post(`/api/data/delete-request/${pending.id}/confirm`, { headers: { cookie: `workout_session=${token}` }, data: { confirm: true } })).status()).toBe(200);
  await page.reload(); await expect(page.getByRole("main").getByRole("alert")).toContainText("Authentication required");
});
