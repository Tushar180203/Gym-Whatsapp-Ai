import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/index.js";
let app: PostgresVerticalSliceApp;
test.beforeEach(async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const admin = new Pool({ connectionString: url }); await admin.query("drop schema if exists release_web_test cascade"); await admin.query("create schema release_web_test"); await admin.end();
  const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=release_web_test");
  app = new PostgresVerticalSliceApp({ connectionString: parsed.toString() }); await app.migrate();
});
test.afterEach(async () => { await app?.close(); });
for (const width of [1280, 390]) test(`signed webhook workout through factual review at ${width}px`, async ({ request, page, context }) => {
  const signup = await request.post("/api/auth/signup", { data: { email: "release-web@example.com", password: "correct horse battery staple" } }); expect(signup.status()).toBe(200);
  const token = signup.headers()["set-cookie"]!.match(/workout_session=([^;]+)/)![1]!;
  const userId = await app.currentUser(token);
  expect((await request.patch("/api/profile", { data: { preferredWeightUnit: "KG" } })).status()).toBe(200);
  const custom = await request.post("/api/exercises/custom", { data: { name: "Incline Dumbbell Press", confirm: true, defaultLoadSemantics: "PER_HAND_PER_SIDE" } }); expect(custom.status()).toBe(200);
  const identity = await custom.json();
  expect((await request.post("/api/routines", { data: { name: "Upper Lower", sessions: [
    { name: "Upper", exercises: [{ exerciseIdentityId: identity.id, plannedSetCount: 3, repTargetMin: 8, repTargetMax: 10 }] },
    { name: "Lower", exercises: [{ exerciseIdentityId: "global_leg_extension", plannedSetCount: 3, repTargetMin: 10 }] }
  ] } })).status()).toBe(200);
  const link = await (await request.post("/api/whatsapp/link-token", { data: {} })).json(); let n = 0;
  async function send(text: string, id = `release-${n++}`) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: "release-web" }, messages: [{ id, from: "15555550888", text: { body: text } }] } }] }] });
    const adapter = new WhatsAppInboundAdapter("release-web-secret"); const result = await request.post("/api/webhooks/whatsapp", { data: raw, headers: { "content-type": "application/json", "x-hub-signature-256": adapter.sign(raw) } });
    expect(result.status()).toBe(200); return (await result.json())[0].body as string;
  }
  const invalid = await request.post("/api/webhooks/whatsapp", { data: "{}", headers: { "x-hub-signature-256": "invalid" } }); expect(invalid.status()).toBe(400);
  await send(`link ${link.token}`); await send("start"); await send("start planned"); await send("45x10,45x9", "sets"); await send("45x10,45x9", "sets"); await send("same x 8");
  await send("actually that was 9"); await send("add Red chest machine today"); expect(await send("yes")).toContain("applied");
  await send("35x10"); await send("done"); await send("save completed");
  const history = await app.history(userId); expect(history).toHaveLength(1); expect(history[0]!.sets.map(set => set.reps)).toEqual([10,9,9,10]);
  const links = await (await request.get("/api/whatsapp/link")).json(); expect(links).toHaveLength(1);
  expect(Object.keys(links[0]).sort()).toEqual(["id", "linkedAt", "revokedAt"]);
  expect((await request.delete(`/api/whatsapp/link/${links[0].id}`)).status()).toBe(200);
  expect((await request.delete(`/api/whatsapp/link/${links[0].id}`)).status()).toBe(200);
  expect((await (await request.get("/api/whatsapp/link")).json())[0].revokedAt).not.toBeNull();
  expect((await app.personalRecords(userId, "Incline Dumbbell Press", "KG", "PER_HAND_PER_SIDE")).highestLoad?.loadValue).toBe(45);
  await context.addCookies([{ name: "workout_session", value: token, url: "http://127.0.0.1:3109", httpOnly: true, sameSite: "Strict" }]);
  await page.setViewportSize({ width, height: 844 }); await page.goto("/history"); await expect(page.getByRole("heading", { name: "Workout History" })).toBeVisible();
  await page.goto(`/history/${history[0]!.workout.id}`); await expect(page.getByText("45 KG each x 10", { exact: false }).first()).toBeVisible();
  await page.goto("/analytics"); await expect(page.locator(".metric-strip dd")).toHaveText(["1","1","4"]);
  await expect(page.getByRole("tab", { name: "Overview" })).toBeEnabled();
  await page.getByRole("tab", { name: "Overview" }).focus(); await page.keyboard.press("ArrowRight"); await expect(page.getByRole("tab", { name: "Muscles" })).toBeFocused();
  await page.keyboard.press("End"); await expect(page.getByRole("tab", { name: "Exercises" })).toBeFocused();
  await page.screenshot({ path: `/tmp/release-${width}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
