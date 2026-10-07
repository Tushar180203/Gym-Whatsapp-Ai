import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/index.js";
import { AiProviderError } from "../../packages/ai/src/interfaces.js";
const url = process.env.TEST_DATABASE_URL;
const pgDescribe = url || process.env.REQUIRE_POSTGRES_TESTS === "1" ? describe : describe.skip;
pgDescribe("release PostgreSQL integrity and isolation", () => {
  let app: PostgresVerticalSliceApp, owner: { userId: string; sessionToken: string }, other: typeof owner, scoped: string;
  const interpret = vi.fn();
  beforeEach(async () => {
    if (!url) throw new Error("TEST_DATABASE_URL required");
    const admin = new Pool({ connectionString: url }); await admin.query("drop schema if exists release_test cascade"); await admin.query("create schema release_test"); await admin.end();
    const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=release_test"); scoped = parsed.toString();
    interpret.mockReset(); app = new PostgresVerticalSliceApp({ connectionString: scoped, interpreter: { interpret } }); await app.migrate();
    owner = await app.signUp("release-owner@example.com", "correct horse battery staple"); other = await app.signUp("release-other@example.com", "correct horse battery staple");
    await app.setPreferredWeightUnit(owner.userId, "KG"); await app.setPreferredWeightUnit(other.userId, "KG"); await app.createRoutine(owner.userId);
    await send("link", `link ${await app.createLinkToken(owner.userId)}`); await send("start", "start"); await send("accept", "start planned");
  });
  afterEach(async () => { await app?.close(); });
  function send(id: string, text: string, from = "15555550123", options = {}) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: "release-account" }, messages: [{ id, from, text: { body: text } }] } }] }] });
    const adapter = new WhatsAppInboundAdapter("fixture-secret"); return app.processInbound(adapter.normalize(raw, adapter.sign(raw))[0]!, options);
  }
  it("fresh migrations and reruns preserve data and ordered migration ledger entries", async () => {
    await app.migrate(); expect((await app.pool.query("select name from schema_migrations order by name")).rows.map(row => row.name)).toEqual(["0001_vertical_slice.sql","0002_us4.sql","0003_us5.sql","0004_us6.sql","0005_us7.sql","0006_release_integrity.sql","0007_core_configuration.sql"]);
    expect(await app.currentUser(owner.sessionToken)).toBe(owner.userId);
  });
  it("database rejects foreign owner/parent relationships even without application checks", async () => {
    await send("owned-set", "45x10");
    const set = (await app.pool.query("select * from workout_sets where user_id=$1", [owner.userId])).rows[0];
    await expect(app.pool.query("update workout_sets set user_id=$1 where id=$2", [other.userId,set.id])).rejects.toMatchObject({ code: "23503" });
    await expect(app.pool.query("update workout_sets set reps=0 where id=$1", [set.id])).rejects.toMatchObject({ code: "23514" });
    const workout = (await app.activeWorkout(owner.userId))!;
    await expect(app.pool.query("update workout_sessions set user_id=$1 where id=$2", [other.userId,workout.id])).rejects.toMatchObject({ code: "23503" });
    await expect(app.pool.query("update routine_sequence_cursors set cursor_sequence_index=999 where user_id=$1", [owner.userId])).rejects.toMatchObject({ code: "23503" });
  });
  it("upgrades a populated five-migration database transactionally and preserves data", async () => {
    await send("upgrade-set", "45x10"); const before = (await app.pool.query("select * from workout_sets where user_id=$1", [owner.userId])).rows;
    // Undo only the new hardening DDL in this isolated test schema to model the prior release.
    const statements: string[] = [];
    for (const [table, names] of [
      ["workout_sessions", ["workout_routine_owner","workout_template_routine","active_exercise_workout"]],
      ["routine_sequence_cursors", ["cursor_routine_owner","cursor_template_position"]],
      ["workout_sets", ["set_workout_owner","set_exercise_workout","set_exercise_identity","valid_set_values"]],
      ["routines", ["routine_owner_key"]], ["workout_session_templates", ["template_routine_key","template_cursor_key"]],
      ["workout_sessions", ["workout_owner_key"]], ["session_exercises", ["session_exercise_workout_key","session_exercise_identity_key"]]
    ] as const) for (const name of names) statements.push(`alter table ${table} drop constraint ${name}`);
    for (const name of ["owner_saved_workouts","owner_session_sets","session_exercise_order","owner_correction_history"]) statements.push(`drop index ${name}`);
    statements.push("delete from schema_migrations where name='0006_release_integrity.sql'");
    await app.pool.query(statements.join(";"));
    await app.migrate(); await app.migrate(); expect((await app.pool.query("select * from workout_sets where user_id=$1", [owner.userId])).rows).toEqual(before);
  });
  it("uses persisted pending/sent states without falsely sending or reapplying on replay/restart", async () => {
    await send("recover", "45x10", undefined, { crashAfterCommandBeforeOutbound: true }); await app.close();
    app = new PostgresVerticalSliceApp({ connectionString: scoped }); await send("recover", "45x10");
    let row = (await app.pool.query("select o.* from outbound_messages o join inbound_messages i on i.id=o.inbound_message_id where i.provider_message_id='recover'")).rows[0];
    expect(row.status).toBe("PENDING"); expect(row.sent_at).toBeNull();
    await app.pool.query("update outbound_messages set status='SENT',sent_at=now() where id=$1", [row.id]);
    const before = (await app.pool.query("select * from outbound_messages where id=$1", [row.id])).rows[0];
    await Promise.all(Array.from({ length: 4 }, () => send("recover", "45x10")));
    expect((await app.pool.query("select * from outbound_messages where id=$1", [row.id])).rows[0]).toEqual(before);
    expect((await app.pool.query("select id from workout_sets where user_id=$1", [owner.userId])).rows).toHaveLength(1);
    await expect(send("recover", "45x10", "15555550444")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("rolls back provider failure, can retry, and deterministic notation never calls AI", async () => {
    interpret.mockRejectedValueOnce(new AiProviderError("Unavailable", "AI_PROVIDER_ERROR", true));
    await expect(send("retry", "interpret this unusual request")).rejects.toMatchObject({ retryable: true });
    expect((await app.pool.query("select id from inbound_messages where provider_message_id='retry'")).rows).toHaveLength(0);
    interpret.mockResolvedValueOnce({ schemaVersion: "workout-action.v1", action: { type: "UNKNOWN", reason: "unsupported" }, confidence: "high", requiresClarification: false, rationaleCodes: [], forbiddenDirectMutation: true });
    await send("retry", "interpret this unusual request"); expect(interpret).toHaveBeenCalledTimes(2);
    await send("set", "45x10"); expect(interpret).toHaveBeenCalledTimes(2);
    expect((await app.pool.query("select id from workout_sets where user_id=$1", [owner.userId])).rows).toHaveLength(1);
  });
  it("rejects foreign history, sets, classifications, lifecycle, exports and confirmation IDs", async () => {
    await send("sets", "45x10,45x9,45x8"); await send("finish", "done");
    const history = (await app.history(owner.userId))[0]!; const detail = await app.historyDetails(owner.sessionToken, history.workout.id);
    await expect(app.historyDetails(other.sessionToken, history.workout.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(app.editHistorySet({ sessionToken: other.sessionToken, workoutId: history.workout.id, setId: detail.sets[0]!.id, replacement: { reps: 11 }, expectedVersion: detail.workout.version, idempotencyKey: "foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(app.workoutLifecycle({ sessionToken: other.sessionToken, workoutId: history.workout.id, intent: "RESUME", idempotencyKey: "foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(app.classifyExercise(other.sessionToken, detail.exercises[0]!.exerciseIdentityId, { classifications: [] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await app.analytics(other.sessionToken)).progression).toHaveLength(0);
    const exp = await app.requestExport(owner.sessionToken, { idempotencyKey: "export" }); await expect(app.exportResult(other.sessionToken, exp.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const deletion = await app.requestDeletion(owner.sessionToken, { type: "DELETE_ACCOUNT", idempotencyKey: "delete" }); await expect(app.confirmDeletion(other.sessionToken, deletion.id, { confirm: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
