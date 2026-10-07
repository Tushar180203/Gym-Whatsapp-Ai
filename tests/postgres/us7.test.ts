import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/index.js";
const url = process.env.TEST_DATABASE_URL;
const pgDescribe = url || process.env.REQUIRE_POSTGRES_TESTS === "1" ? describe : describe.skip;
pgDescribe("US7 PostgreSQL portable export and confirmed data control", () => {
  let app: PostgresVerticalSliceApp, scoped: string, owner: { userId: string; sessionToken: string }, other: typeof owner, workoutId: string, exerciseId: string, next: number;
  beforeEach(async () => {
    if (!url) throw new Error("TEST_DATABASE_URL required");
    const admin = new Pool({ connectionString: url }); await admin.query("drop schema if exists us7_test cascade"); await admin.query("create schema us7_test"); await admin.end();
    const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=us7_test"); scoped = parsed.toString();
    app = new PostgresVerticalSliceApp({ connectionString: scoped }); await app.migrate(); next = 0;
    owner = await app.signUp("us7-owner@example.com", "correct horse battery staple"); other = await app.signUp("us7-other@example.com", "correct horse battery staple");
    for (const user of [owner, other]) { await app.setPreferredWeightUnit(user.userId, "LB"); await app.createRoutine(user.userId); }
    await send(`link ${await app.createLinkToken(owner.userId)}`); await send("start"); await send("start planned"); workoutId = (await app.activeWorkout(owner.userId))!.id;
    await send("45 lb x 10,45 lb x 9,45 lb x 8", "original-log"); await send("done");
    exerciseId = (await app.pool.query("select exercise_identity_id from workout_sets where user_id=$1 limit 1", [owner.userId])).rows[0].exercise_identity_id;
    await app.classifyExercise(owner.sessionToken, exerciseId, { classifications: [{ muscleGroup: "Chest", status: "CONFIRMED", role: "PRIMARY" }] });
    await app.pool.query("insert into exercise_aliases(id,user_id,exercise_identity_id,alias_text,normalized_alias,status) values('alias',$1,$2,'incline','incline','CONFIRMED')", [owner.userId, exerciseId]);
    const history = await app.historyDetails(owner.sessionToken, workoutId);
    await app.editHistorySet({ sessionToken: owner.sessionToken, workoutId, setId: history.sets[0]!.id, replacement: { reps: 11 }, expectedVersion: history.workout.version, idempotencyKey: "edit" });
  });
  afterEach(async () => { await app?.close(); });
  async function restart() { await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scoped }); }
  async function send(text: string, id = `us7-${next++}`) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: "us7-phone" }, messages: [{ id, from: "15555550123", text: { body: text } }] } }] }] });
    const adapter = new WhatsAppInboundAdapter("secret"); return app.processInbound(adapter.normalize(raw, adapter.sign(raw))[0]!);
  }
  async function request(type: "DELETE_ACCOUNT" | "DELETE_WORKOUT_DATA" = "DELETE_WORKOUT_DATA", idempotencyKey = "delete") { return app.requestDeletion(owner.sessionToken, { type, idempotencyKey }); }
  it("exports all approved owner categories with portable current values, no credentials and durable status", async () => {
    const first = await app.requestExport(owner.sessionToken, { idempotencyKey: "export" }); expect(await app.requestExport(owner.sessionToken, { idempotencyKey: "export" })).toEqual(first);
    const result = await app.exportResult(owner.sessionToken, first.id); const data = result.data.data;
    for (const category of ["account", "profile", "links", "routines", "templates", "plannedExercises", "exercises", "aliases", "classifications", "workouts", "sessionExercises", "sets", "corrections", "cursors"]) expect(data[category].length).toBeGreaterThan(0);
    expect(data.sets.map((set: any) => set.reps)).toContain(11); expect(data.sets[0].weight_unit).toBe("LB");
    const json = JSON.stringify(result.data); expect(json).not.toContain(other.userId); expect(json).not.toContain("us7-other@example.com");
    for (const forbidden of ["password_hash", "token_hash", "creator_session_hash", "GEMINI_API_KEY", "source_message_id", "idempotency_key", "provider_user_identity_hash"]) expect(json).not.toContain(forbidden);
    expect(first).toMatchObject({ type: "EXPORT", status: "COMPLETED", userId: owner.userId }); await restart(); expect(await app.exportResult(owner.sessionToken, first.id)).toEqual(result);
  });
  it("rejects cross-user export, deletion requests and confirmation; request IDs cannot bypass owner checks", async () => {
    const exp = await app.requestExport(owner.sessionToken, { idempotencyKey: "export" });
    await expect(app.exportResult(other.sessionToken, exp.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(app.requestDeletion(other.sessionToken, { type: "DELETE_WORKOUT_DATA", idempotencyKey: "foreign", userId: owner.userId })).rejects.toThrow();
    const deletion = await request(); await expect(app.confirmDeletion(other.sessionToken, deletion.id, { confirm: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(app.confirmDeletion(owner.sessionToken, deletion.id, {})).rejects.toThrow(); expect(await app.history(owner.userId)).toHaveLength(1);
    expect((await app.dataReview(other.sessionToken)).requests).toHaveLength(0);
  });
  it("workout deletion hides data from history, PRs, analytics, previous performance, questions and old exports after restart", async () => {
    await app.pool.query("insert into command_executions(id,user_id,command_type,idempotency_key,status,result_summary) values('old-finish',$1,'FINISH_WORKOUT',$2,'COMPLETED',$3)", [owner.userId, `web:${workoutId}:finish:old-result`, { body: "Old completion: 45 LB x 11" }]);
    const exp = await app.requestExport(owner.sessionToken, { idempotencyKey: "export" }); const deletion = await request();
    expect(await app.history(owner.userId)).toHaveLength(1); const completed = await app.confirmDeletion(owner.sessionToken, deletion.id, { confirm: true });
    expect(completed).toMatchObject({ status: "COMPLETED", auditSummary: { mode: "SOFT_DELETE", workoutsAffected: 1, setsAffected: 3 } });
    expect(completed.confirmedAt).not.toBeNull(); expect(completed.completedAt).not.toBeNull(); await restart();
    expect(await app.history(owner.userId)).toHaveLength(0); await expect(app.historyDetails(owner.sessionToken, workoutId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(app.workoutLifecycle({ sessionToken: owner.sessionToken, workoutId, intent: "COMPLETE", idempotencyKey: "old-result" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await app.analytics(owner.sessionToken)).completedWorkoutCount).toBe(0); expect((await app.analytics(owner.sessionToken)).progression).toHaveLength(0);
    expect(await app.previousPerformance(owner.userId, "incline", "LB", "PER_HAND_PER_SIDE")).toBeNull();
    expect((await app.personalRecords(owner.userId, "incline", "LB", "PER_HAND_PER_SIDE")).highestLoad).toBeNull();
    expect((await send("What's my best incline?")).body).toContain("No recorded history");
    expect((await app.exportResult(owner.sessionToken, exp.id)).data).toBeNull();
    expect((await app.dataReview(owner.sessionToken)).requests.find(row => row.id === deletion.id)).toEqual(completed);
    const newExp = await app.requestExport(owner.sessionToken, { idempotencyKey: "new-export" }); expect((await app.exportResult(owner.sessionToken, newExp.id)).data.data.workouts).toHaveLength(0);
  });
  it("duplicate requests, concurrent confirmations and retries apply once and preserve unaffected users/global definitions", async () => {
    await app.pool.query("insert into exercise_identities(id,display_name,default_load_semantics) values('global','Shared Exercise','TOTAL_LOAD')");
    const deletion = await request(); expect(await request()).toEqual(deletion);
    await expect(request("DELETE_ACCOUNT", "other-delete")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const before = (await app.pool.query("select version from workout_sessions where id=$1", [workoutId])).rows[0].version;
    const results = await Promise.all(Array.from({ length: 4 }, () => app.confirmDeletion(owner.sessionToken, deletion.id, { confirm: true })));
    for (const result of results) expect(result).toEqual(results[0]);
    expect((await app.pool.query("select version from workout_sessions where id=$1", [workoutId])).rows[0].version).toBe(before + 1);
    await restart(); expect(await app.confirmDeletion(owner.sessionToken, deletion.id, { confirm: true })).toEqual(results[0]);
    expect((await app.pool.query("select id from exercise_identities where id='global'")).rows).toHaveLength(1);
    expect((await app.pool.query("select id from routines where user_id=$1", [other.userId])).rows).toHaveLength(1); expect(await app.currentUser(other.sessionToken)).toBe(other.userId);
  });
  it("expired and stale confirmations persist terminal status without deleting data", async () => {
    const expired = await request(); await app.pool.query("update data_control_requests set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
    expect((await app.confirmDeletion(owner.sessionToken, expired.id, { confirm: true })).status).toBe("EXPIRED");
    const stale = await request("DELETE_WORKOUT_DATA", "stale"); const history = await app.historyDetails(owner.sessionToken, workoutId);
    await app.editHistorySet({ sessionToken: owner.sessionToken, workoutId, setId: history.sets[0]!.id, replacement: { reps: 12 }, expectedVersion: history.workout.version, idempotencyKey: "changed" });
    expect((await app.confirmDeletion(owner.sessionToken, stale.id, { confirm: true })).status).toBe("STALE"); await restart();
    expect(await app.history(owner.userId)).toHaveLength(1); expect((await app.dataReview(owner.sessionToken)).requests.map(row => row.status)).toContain("STALE");
  });
  it("confirmed account deletion blocks sessions, linked messages and old link tokens; only exact completed receipt can replay", async () => {
    const link = await app.createLinkToken(owner.userId), deletion = await request("DELETE_ACCOUNT");
    const completed = await app.confirmDeletion(owner.sessionToken, deletion.id, { confirm: true }); await restart();
    expect(await app.confirmDeletion(owner.sessionToken, deletion.id, { confirm: true })).toEqual(completed);
    await expect(app.currentUser(owner.sessionToken)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(app.requestExport(owner.sessionToken, { idempotencyKey: "new" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(app.startNextWorkout(owner.userId)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(send("start")).rejects.toMatchObject({ code: "UNLINKED_IDENTITY" });
    await expect(send(`link ${link}`)).rejects.toMatchObject({ code: "INVALID_LINK_TOKEN" });
    await expect(send("45 lb x 10,45 lb x 9,45 lb x 8", "original-log")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(app.confirmDeletion(other.sessionToken, deletion.id, { confirm: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await app.currentUser(other.sessionToken)).toBe(other.userId);
    const replacement = await app.signUp("us7-owner@example.com", "correct horse battery staple");
    expect(replacement.userId).not.toBe(owner.userId); expect(await app.history(replacement.userId)).toHaveLength(0);
    await expect(app.confirmDeletion(replacement.sessionToken, deletion.id, { confirm: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("old webhook replay cannot return deleted factual answers or mutate a newly started workout", async () => {
    const answer = await send("What's my best incline?", "old-history"); expect(answer.body).toContain("45 LB");
    const deletion = await request(); await app.confirmDeletion(owner.sessionToken, deletion.id, { confirm: true });
    expect((await send("What's my best incline?", "old-history")).body).toBe("Previous workout data is no longer available.");
    await send("start"); await send("start planned"); expect((await send("45 lb x 10,45 lb x 9,45 lb x 8", "original-log")).reused).toBe(true);
    expect((await app.pool.query("select id from workout_sets where user_id=$1 and status='RECORDED'", [owner.userId])).rows).toHaveLength(0);
  });
  it("deletes active sessions too, preserves routine configuration, and uses approved discarded lifecycle state", async () => {
    await send("start"); await send("start planned"); await send("80 lb x 5"); const deletion = await request();
    const result = await app.confirmDeletion(owner.sessionToken, deletion.id, { confirm: true });
    expect(result.auditSummary.workoutsAffected).toBe(2); expect(await app.activeWorkout(owner.userId)).toBeNull();
    const rows = (await app.pool.query("select status,data_deleted_at from workout_sessions where user_id=$1", [owner.userId])).rows;
    expect(rows.every(row => row.status === "DISCARDED" && row.data_deleted_at)).toBe(true);
    expect((await app.pool.query("select id from routines where user_id=$1", [owner.userId])).rows).toHaveLength(1);
    await restart(); expect((await app.analytics(owner.sessionToken)).progression).toHaveLength(0);
  });
});
