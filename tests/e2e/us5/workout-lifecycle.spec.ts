import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../../packages/persistence/src/postgres.js";
import { WhatsAppInboundAdapter } from "../../../packages/messaging/src/index.js";

let app: PostgresVerticalSliceApp, userId: string, sessionToken: string;
test.beforeEach(async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const admin = new Pool({ connectionString: url });
  await admin.query("drop schema if exists us5_web_test cascade"); await admin.query("create schema us5_web_test"); await admin.end();
  const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=us5_web_test");
  app = new PostgresVerticalSliceApp({ connectionString: parsed.toString() }); await app.migrate();
});
test.afterEach(async () => { await app?.close(); });
test("real HTTP signup/link/webhook/log/resume/finish/history with exact persisted metrics", async ({ request }) => {
  const auth = await request.post("/api/auth/signup", { data: { email: "us5-http@example.com", password: "correct horse battery staple" } });
  expect(auth.status()).toBe(200);
  const cookie = auth.headers()["set-cookie"]!; sessionToken = cookie.match(/workout_session=([^;]+)/)![1]!;
  userId = await app.currentUser(sessionToken);
  expect((await request.patch("/api/profile", { data: { preferredWeightUnit: "LB" } })).status()).toBe(200);
  // Routine setup uses the existing repository API; a routine editor endpoint is outside US5.
  await app.createRoutine(userId);
  const link = await request.post("/api/whatsapp/link-token", { data: {} }); const token = (await link.json()).token;
  let n = 0;
  async function send(text: string, id = `http-${n++}`) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: "phone-http" }, messages: [{ id, from: "15555550999", text: { body: text } }] } }] }] });
    const adapter = new WhatsAppInboundAdapter("us5-web-secret");
    const response = await request.post("/api/webhooks/whatsapp", { data: raw, headers: { "content-type": "application/json", "x-hub-signature-256": adapter.sign(raw) } });
    expect(response.status()).toBe(200); return response.json();
  }
  await send(`link ${token}`); await send("start"); await send("45 lb x 10", "single-set"); await send("45 lb x 10", "single-set");
  const active = await (await request.get("/api/workouts/active")).json();
  const resume = await request.post(`/api/workouts/${active.id}/resume`); expect(resume.status()).toBe(200);
  expect((await resume.json()).body).toContain("Resumed Upper");
  expect((await (await request.get("/api/workouts/active")).json()).id).toBe(active.id);
  const finish = await request.post(`/api/workouts/${active.id}/finish`, { data: { idempotencyKey: "ask-finish" } });
  expect((await finish.json()).body).toContain("Unfinished work remains");
  expect(await (await request.get("/api/workouts/history")).json()).toHaveLength(0);
  const data = { idempotencyKey: "confirm-finish", requestedCompletion: "COMPLETE" };
  const complete = await request.post(`/api/workouts/${active.id}/finish`, { data });
  expect(complete.status()).toBe(200); const summary = await complete.json(); expect(summary.body).toContain("45 LB each x 10");
  expect(await (await request.post(`/api/workouts/${active.id}/finish`, { data })).json()).toEqual(summary);
  const history = await (await request.get("/api/workouts/history")).json(); expect(history).toHaveLength(1); expect(history[0].sets).toHaveLength(1);
  const detail = await (await request.get(`/api/workouts/${active.id}`)).json(); expect(detail.summary).toContain("1 exercises, 1 sets");
  await send("start"); await send("add Incline Dumbbell Press today");
  expect((await app.previousPerformance(userId, "Incline Dumbbell Press", "LB", "PER_HAND_PER_SIDE"))?.[0]).toMatchObject({ loadValue: 45, reps: 10 });
  expect((await app.personalRecords(userId, "Incline Dumbbell Press", "LB", "PER_HAND_PER_SIDE")).highestLoad?.loadValue).toBe(45);
});

test("HTTP owner, CSRF, empty finish and discard retry safety", async ({ request }) => {
  const owner = await app.signUp("owner-http@example.com", "correct horse battery staple");
  await app.setPreferredWeightUnit(owner.userId, "KG"); await app.createRoutine(owner.userId); const active = (await app.startNextWorkout(owner.userId))!;
  const other = await app.signUp("foreign-http@example.com", "correct horse battery staple");
  const path = `/api/workouts/${active.id}`;
  expect((await request.post(`${path}/resume`, { headers: { cookie: `workout_session=${other.sessionToken}` } })).status()).toBe(404);
  const headers = { cookie: `workout_session=${owner.sessionToken}` };
  expect((await request.post(`${path}/finish`, { headers: { ...headers, origin: "https://foreign.example" }, data: { idempotencyKey: "csrf" } })).status()).toBe(403);
  const empty = await request.post(`${path}/finish`, { headers, data: { requestedCompletion: "COMPLETE", idempotencyKey: "empty" } }); expect((await empty.json()).body).toContain("No recorded sets");
  await request.post(`${path}/resume`, { headers });
  const data = { idempotencyKey: "discard-proposal" };
  const first = await (await request.post(`${path}/discard`, { headers, data })).json(); expect(first.body).toContain("confirm");
  expect(await (await request.post(`${path}/discard`, { headers, data })).json()).toEqual(first);
  expect(await app.activeWorkout(owner.userId)).not.toBeNull();
  expect((await request.post(`${path}/discard`, { headers, data: { idempotencyKey: "discard-confirmed" } })).status()).toBe(200);
  expect(await app.activeWorkout(owner.userId)).toBeNull();
  await app.logout(owner.sessionToken);
  expect((await request.post(`${path}/resume`, { headers })).status()).toBe(401);
});
