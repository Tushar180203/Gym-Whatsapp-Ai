import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/index.js";
import { hashChallenge } from "../../packages/messaging/src/whatsapp/link-challenge.js";

const url = process.env.TEST_DATABASE_URL;
const pgDescribe = url || process.env.REQUIRE_POSTGRES_TESTS === "1" ? describe : describe.skip;
pgDescribe("Phase A deterministic proposal, selection and replacement", () => {
  let app: PostgresVerticalSliceApp, scoped: string, owner: { userId: string; sessionToken: string }, next: number;
  const interpret = vi.fn();
  const input = () => ({ name: "My rotation", sessions: [
    { name: "Upper", exercises: [{ exerciseIdentityId: "global_barbell_bench_press", plannedSetCount: 1, repTargetMin: 8 }, { exerciseIdentityId: "global_lat_pulldown", plannedSetCount: 1, repTargetMin: 10 }] },
    { name: "Lower", exercises: [{ exerciseIdentityId: "global_leg_extension", plannedSetCount: 2, repTargetMin: 10 }] }
  ] });
  beforeEach(async () => {
    if (!url) throw new Error("TEST_DATABASE_URL required");
    const admin = new Pool({ connectionString: url }); await admin.query("drop schema if exists phase_a_selection_test cascade"); await admin.query("create schema phase_a_selection_test"); await admin.end();
    const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=phase_a_selection_test"); scoped = parsed.toString();
    interpret.mockReset(); app = new PostgresVerticalSliceApp({ connectionString: scoped, interpreter: { interpret } }); await app.migrate(); next = 0;
    owner = await app.signUp("selection@example.com", "correct horse battery staple");
    await app.configure(owner.sessionToken, c => c.profile({ preferredWeightUnit: "KG" }));
    await app.configure(owner.sessionToken, c => c.saveRoutine(input()));
    await send(`link ${await app.createLinkToken(owner.userId, hashChallenge("15555550123"))}`);
  });
  afterEach(async () => { await app?.close(); });
  async function send(text: string, id = `choice-${next++}`) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: "selection-account" }, messages: [{ id, from: "15555550123", text: { body: text } }] } }] }] });
    const adapter = new WhatsAppInboundAdapter("secret"); return app.processInbound(adapter.normalize(raw, adapter.sign(raw))[0]!);
  }
  async function cursor() { return (await app.pool.query("select c.*,t.name from routine_sequence_cursors c join workout_session_templates t on t.id=c.next_session_template_id where c.user_id=$1", [owner.userId])).rows[0]; }
  it.each(["start", "let's start", "gym time", "start workout"])("%s proposes the full plan without AI or premature activation", async text => {
    const result = await send(text); expect(result.body).toContain("Proposed Upper"); expect(result.body).toContain("Barbell Bench Press"); expect(result.body).toContain("Lat Pulldown");
    expect((await app.activeWorkout(owner.userId))!.status).toBe("PROPOSED"); expect(interpret).not.toHaveBeenCalled();
    expect((await send("resume")).body).toContain("Start planned workout");
    expect((await app.activeWorkout(owner.userId))!.status).toBe("PROPOSED");
    expect((await send("50x8")).body).toContain("START");
    expect((await app.pool.query("select id from workout_sets where user_id=$1", [owner.userId])).rows).toEqual([]);
    expect((await send("start planned")).body).toContain("Started Upper"); await send("50x8 failed the 9th");
    expect((await app.pool.query("select reps from workout_sets where user_id=$1", [owner.userId])).rows).toEqual([{ reps: 8 }]);
  });
  it("clarifies multiple routines and ambiguous session names without creating a workout", async () => {
    await app.configure(owner.sessionToken, c => c.saveRoutine({ ...input(), name: "Second rotation" }));
    expect((await send("start")).body).toContain("Which routine/session?");
    expect((await send("choose Lower")).body).toContain("Which routine/session?");
    expect((await app.pool.query("select id from workout_sessions where user_id=$1", [owner.userId])).rows).toEqual([]);
    expect((await send("start routine My rotation")).body).toContain("Proposed Upper");
  });
  it("supports temporary pre-start changes, alternative completion and rest without advancing normal progress", async () => {
    await send("start"); await send("do Lat Pulldown first");
    const routine = (await app.configure(owner.sessionToken, c => c.routines()))[0]!;
    expect(routine.sessions[0]!.exercises[0]!.exerciseIdentityId).toBe("global_barbell_bench_press");
    await send("choose Lower today"); expect((await app.activeWorkout(owner.userId))!.name).toBe("Lower");
    await send("start planned"); await send("20x10,20x10"); await send("done");
    expect((await cursor()).name).toBe("Upper"); expect((await app.history(owner.userId))[0]!.workout.status).toBe("COMPLETED");
    await send("start"); await send("rest"); expect(await app.activeWorkout(owner.userId)).toBeNull(); expect((await cursor()).name).toBe("Upper");
  });
  it("validates AI START_WORKOUT but never accepts a proposal or inferred replacement", async () => {
    interpret.mockResolvedValue({ schemaVersion: "workout-action.v1", action: { type: "START_WORKOUT" }, confidence: "high", requiresClarification: false, rationaleCodes: [], forbiddenDirectMutation: true });
    await send("begin my training"); expect(interpret).toHaveBeenCalledOnce(); expect((await app.activeWorkout(owner.userId))!.status).toBe("PROPOSED");
    await send("start planned"); const id = (await app.activeWorkout(owner.userId))!.id;
    await send("begin my training"); expect((await app.activeWorkout(owner.userId))!.id).toBe(id);
    interpret.mockResolvedValue({ schemaVersion: "workout-action.v1", action: { type: "UPDATE_ROUTINE_REQUEST", scope: "SESSION_ONLY", requestedChange: { operation: "REORDER_SESSION", sessionRef: "Lower", newOrderRef: "1" } }, confidence: "high", requiresClarification: false, rationaleCodes: [], forbiddenDirectMutation: true });
    expect((await send("do the other session first today")).body).toContain("replace?");
    expect((await app.configure(owner.sessionToken, c => c.routines()))[0]!.sessions.map(session => session.name)).toEqual(["Upper", "Lower"]);
    expect((await app.pool.query("select id from pending_confirmations where status='PENDING'")).rows).toEqual([]);
  });
  it("replacement is confirmed, restart-durable and applied once across concurrent/replayed confirmation", async () => {
    await send("start"); await send("start planned"); await send("50x8"); const old = (await app.activeWorkout(owner.userId))!.id;
    expect((await send("start")).body).toContain("replace?"); expect((await send("replace workout with Lower", "replacement-request")).body).toContain("Reply yes");
    await send("replace workout with Lower", "replacement-request"); expect((await app.activeWorkout(owner.userId))!.id).toBe(old);
    await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scoped, interpreter: { interpret } });
    await Promise.all([send("confirm", "replace-confirm"), send("confirm", "replace-confirm"), send("yes", "replace-confirm-other")]);
    const replacement = (await app.activeWorkout(owner.userId))!; expect(replacement.id).not.toBe(old); expect(replacement.name).toBe("Lower"); expect(replacement.status).toBe("ACTIVE");
    expect((await app.pool.query("select status from workout_sessions where id=$1", [old])).rows[0].status).toBe("CANCELLED_REPLACED");
    expect((await app.pool.query("select id from corrections where type='REPLACE_WORKOUT'")).rows).toHaveLength(1);
    await send("20x10,20x10"); await send("done"); expect((await cursor()).name).toBe("Upper");
  });
  it("stale replacement cannot execute; foreign web request IDs cannot authorize replacement", async () => {
    await send("start"); await send("start planned"); await send("replace workout with Lower"); await send("50x8");
    const before = (await app.activeWorkout(owner.userId))!.id; expect((await send("yes")).body).toContain("target changed"); expect((await app.activeWorkout(owner.userId))!.id).toBe(before);
    const other = await app.signUp("foreign-selection@example.com", "correct horse battery staple");
    await expect(app.selectWorkout(other.sessionToken, { kind: "REPLACE", workoutId: before, expectedVersion: 1, sessionRef: "Lower", idempotencyKey: "foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("permanent sequence reorder revalidates cursor/version, preserves snapshots and repeats safely", async () => {
    await send("start"); await send("start planned"); const active = (await app.activeWorkout(owner.userId))!.id;
    const snapshot = (await app.pool.query("select template_snapshot from workout_sessions where id=$1", [active])).rows[0].template_snapshot;
    await send("permanently move session Lower to first"); expect((await cursor()).cursor_sequence_index).toBe(0);
    await Promise.all([send("confirm"), send("yes")]);
    expect((await app.configure(owner.sessionToken, c => c.routines()))[0]!.sessions.map(session => session.name)).toEqual(["Lower", "Upper"]);
    expect((await cursor()).name).toBe("Upper"); expect((await cursor()).cursor_sequence_index).toBe(1);
    expect((await app.pool.query("select template_snapshot from workout_sessions where id=$1", [active])).rows[0].template_snapshot).toEqual(snapshot);
    expect((await app.pool.query("select id from corrections where type='REORDER_SESSION'")).rows).toHaveLength(1);
    await send("permanently move session Upper to first"); await app.pool.query("update routine_sequence_cursors set version=version+1 where user_id=$1", [owner.userId]);
    expect((await send("yes")).body).toContain("target changed");
  });
  it("owner-scoped web set commands and confirmed deletion replay safely", async () => {
    await send("start"); await send("start planned"); const workout = (await app.activeWorkout(owner.userId))!;
    const value = { notation: "50x8 failed the 9th", expectedVersion: workout.version, idempotencyKey: "web-set" };
    await Promise.all([app.recordWebSets(owner.sessionToken, workout.id, value), app.recordWebSets(owner.sessionToken, workout.id, value)]);
    const rows = (await app.pool.query("select id,reps from workout_sets where workout_session_id=$1", [workout.id])).rows;
    expect(rows).toHaveLength(1); expect(rows[0].reps).toBe(8);
    const other = await app.signUp("web-other@example.com", "correct horse battery staple");
    await expect(app.recordWebSets(other.sessionToken, workout.id, value)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const active = (await app.activeWorkout(owner.userId))!;
    const request = { expectedVersion: active.version, idempotencyKey: "delete-request" };
    const pending = await app.deleteWebSet(owner.sessionToken, workout.id, rows[0].id, request);
    expect(pending.confirmationId).toBeTruthy();
    await expect(app.deleteWebSet(other.sessionToken, workout.id, rows[0].id, request)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const confirmation = { ...request, idempotencyKey: "delete-confirm", confirm: true, confirmationId: pending.confirmationId };
    await Promise.all([app.deleteWebSet(owner.sessionToken, workout.id, rows[0].id, confirmation), app.deleteWebSet(owner.sessionToken, workout.id, rows[0].id, confirmation)]);
    expect((await app.pool.query("select status from workout_sets where id=$1", [rows[0].id])).rows[0].status).toBe("DELETED");
    expect((await app.pool.query("select id from corrections where type='DELETE_SET'")).rows).toHaveLength(1);
  });
});
