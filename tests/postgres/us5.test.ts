import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/index.js";
import { hashChallenge } from "../../packages/messaging/src/whatsapp/link-challenge.js";
import { MockStructuredOutputClient, StaticPromptRegistry, StructuredIntentInterpreter } from "../../packages/ai/src/index.js";

const url = process.env.TEST_DATABASE_URL;
const pgDescribe = url || process.env.REQUIRE_POSTGRES_TESTS === "1" ? describe : describe.skip;
pgDescribe("US5 durable deterministic context, records and lifecycle", () => {
  let app: PostgresVerticalSliceApp, userId: string, sessionToken: string, scopedUrl: string, next: number, mock: MockStructuredOutputClient;
  beforeEach(async () => {
    if (!url) throw new Error("TEST_DATABASE_URL required");
    const admin = new Pool({ connectionString: url });
    await admin.query("drop schema if exists us5_test cascade"); await admin.query("create schema us5_test"); await admin.end();
    const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=us5_test"); scopedUrl = parsed.toString();
    mock = new MockStructuredOutputClient();
    app = new PostgresVerticalSliceApp({ connectionString: scopedUrl, interpreter: new StructuredIntentInterpreter(mock, new StaticPromptRegistry("mock")) });
    await app.migrate(); next = 0;
    ({ userId, sessionToken } = await app.signUp("us5@example.com", "correct horse battery staple"));
    await app.setPreferredWeightUnit(userId, "LB"); await app.createRoutine(userId);
    await send(`link ${await app.createLinkToken(userId, hashChallenge("15555550123"))}`); await send("start"); await send("start planned");
  });
  afterEach(async () => { await app?.close(); });
  async function send(text: string, messageId = `us5-${next++}`, crash = false) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business-1", changes: [{ value: { metadata: { phone_number_id: "phone-1" }, messages: [{ id: messageId, from: "15555550123", text: { body: text } }] } }] }] });
    const adapter = new WhatsAppInboundAdapter("secret");
    return app.processInbound(adapter.normalize(raw, adapter.sign(raw))[0]!, { crashAfterCommandBeforeOutbound: crash });
  }
  async function query(sql: string, values: unknown[] = []) { return (await app.pool.query(sql, values)).rows; }
  async function restart() { await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scopedUrl }); }
  async function prior() { return app.previousPerformance(userId, "Incline Dumbbell Press", "LB", "PER_HAND_PER_SIDE"); }
  async function records() { return app.personalRecords(userId, "Incline Dumbbell Press", "LB", "PER_HAND_PER_SIDE"); }
  async function cursor() { return (await query("select cursor_sequence_index from routine_sequence_cursors where user_id=$1", [userId]))[0].cursor_sequence_index; }

  it("partial done persists a choice; continue/resume preserves the same workout and exercise context", async () => {
    await send("45x10"); const before = (await query("select id,active_session_exercise_id from workout_sessions"))[0];
    expect((await send("done")).body).toBe("*🤔 Quick question*\n\nUnfinished work remains.\n\nReply with one option:\n• Save completed\n• Save incomplete\n• Continue\n• Discard");
    expect(await app.history(userId)).toHaveLength(0); expect(await cursor()).toBe(0);
    await restart(); expect((await query("select completion_choice_pending from workout_sessions"))[0].completion_choice_pending).toBe(true);
    await send("continue"); await send("resume");
    expect((await query("select id,active_session_exercise_id from workout_sessions"))[0]).toEqual(before);
    expect((await send("start")).body).toContain("already active");
    await send("same x 9"); expect((await query("select reps from workout_sets order by set_index")).map(row => row.reps)).toEqual([10,9]);
    expect(await query("select id from workout_sessions")).toHaveLength(1);
  });

  it("explicit completed finish survives restart and replay; summary uses persisted values and duration", async () => {
    await send("45x10"); await query("update workout_sessions set started_at=now()-interval '125 seconds'");
    await send("done"); const first = await send("save completed", "finish-once", true);
    expect(first.body).toContain("Upper: completed"); expect(first.body).toContain("*Session totals*\nExercises: 1\nSets: 1\nDuration: 2m 5s"); expect(first.body).toContain("45 LB each x 10");
    await restart(); expect((await send("save completed", "finish-once")).body).toBe(first.body);
    expect((await app.history(userId))[0]?.workout).toMatchObject({ status: "COMPLETED", durationSeconds: 125 });
    expect(await cursor()).toBe(1);
    expect(await query("select id from command_executions where command_type='FINISH_WORKOUT'")).toHaveLength(1);
  });

  it("fully recorded and explicitly skipped work completes normally", async () => {
    await send("45x10,45x9"); await send("skip set");
    expect((await send("finish")).body).toContain("completed"); expect(await cursor()).toBe(1);
  });

  it("save incomplete retains data and does not advance; empty completion never fabricates a completed session", async () => {
    expect((await send("done")).body).toBe("*🤔 Quick question*\n\nNo recorded sets.\n\nReply with one option:\n• Save incomplete\n• Continue\n• Discard");
    expect((await send("save completed")).body).toContain("No recorded sets");
    await send("45x10"); await send("save incomplete"); await restart();
    expect((await app.history(userId))[0]?.workout.status).toBe("INCOMPLETE"); expect(await prior()).toHaveLength(1); expect(await cursor()).toBe(0);
  });

  it("discard is explicit, excluded from history/PRs, durable and does not advance", async () => {
    await send("45x10"); expect((await send("discard workout")).body).toContain("confirm");
    expect(await app.activeWorkout(userId)).not.toBeNull();
    await send("discard workout"); await restart(); expect(await app.activeWorkout(userId)).toBeNull();
    expect(await app.history(userId)).toHaveLength(0); expect((await records()).highestLoad).toBeNull(); expect(await cursor()).toBe(0);
  });

  it("off-sequence completion preserves the cursor", async () => {
    await send("45x10,45x9,45x8"); await query("update workout_sessions set sequence_progression_policy='PRESERVE_NORMAL_SEQUENCE'");
    await send("done"); await restart(); expect(await cursor()).toBe(0);
  });

  it("exact identity, confirmed alias and compatible history survive restart; no similar/unsafe fallback", async () => {
    await send("45x10,50x8,45x9"); await send("done");
    const identity = (await query("select id from exercise_identities where display_name='Incline Dumbbell Press'"))[0].id;
    // Exercise the existing confirmation path rather than seeding an alias.
    await send("start"); await send("start planned");
    mock.enqueue({ schemaVersion: "workout-action.v1", action: { type: "MAP_EXERCISE_ALIAS", alias: "incline", exerciseRef: "Incline Dumbbell Press" }, confidence: "high", requiresClarification: false, rationaleCodes: [], forbiddenDirectMutation: true });
    await send("call Incline Dumbbell Press incline"); await send("confirm");
    expect((await send("add Smith Incline Press today")).body).toContain("Reply yes");
    expect((await send("confirm")).body).toContain("No earlier sets recorded for this exercise yet");
    await restart();
    const expected = await prior(); expect(expected?.map(set => [set.loadValue,set.reps])).toEqual([[45,10],[50,8],[45,9]]);
    expect(await app.previousPerformance(userId, "incline", "LB", "PER_HAND_PER_SIDE")).toEqual(expected);
    expect(await app.previousPerformance(userId, identity, "LB", "PER_HAND_PER_SIDE")).toEqual(expected);
    expect(await app.previousPerformance(userId, "Smith Incline Press", "LB", "PER_HAND_PER_SIDE")).toBeNull();
    expect(await app.previousPerformance(userId, "incline", "KG", "PER_HAND_PER_SIDE")).toBeNull();
    expect(await app.previousPerformance(userId, "incline", "LB", "TOTAL_LOAD")).toBeNull();
    expect((await records()).highestLoad?.loadValue).toBe(50);
    expect((await records()).highestRepsAtLoad.map(set => [set.loadValue,set.reps])).toEqual([[45,10],[50,8]]);
  });

  it("current corrected values and soft deletions change derived PRs after restart", async () => {
    await send("45x10,50x8,45x9"); await send("done");
    const workout = (await app.history(userId))[0]!.workout;
    const detail = await app.historyDetails(sessionToken, workout.id); const target = detail.sets[1]!;
    await app.editHistorySet({ sessionToken, workoutId: workout.id, setId: target.id, replacement: { loadValue: 40, reps: 12 }, idempotencyKey: "correct-pr", expectedVersion: detail.workout.version });
    expect((await records()).highestLoad?.loadValue).toBe(45);
    mock.enqueue({ schemaVersion: "workout-action.v1", action: { type: "DELETE_SET", targetRef: detail.sets[0]!.id }, confidence: "high", requiresClarification: false, rationaleCodes: [], forbiddenDirectMutation: true });
    expect((await send("delete the first recorded set from my completed Upper workout")).body).toContain("Reply yes");
    expect((await send("confirm")).body).toContain("applied"); await restart();
    expect((await records()).highestLoad).toMatchObject({ loadValue: 45, reps: 9 });
    expect((await records()).highestRepsAtLoad.map(set => [set.loadValue,set.reps])).toEqual([[40,12],[45,9]]);
    expect((await prior())?.map(set => set.reps)).toEqual([12,9]);
  });

  it("latest comparable session only, concise active context, and snapshot history ignore mutable templates", async () => {
    await send("45x10"); await send("save incomplete");
    expect((await send("start")).body).toContain("Last time: 45 LB each x 10");
    await send("start planned");
    await send("40x8"); await send("save incomplete");
    expect((await prior())?.map(set => [set.loadValue,set.reps])).toEqual([[40,8]]);
    const workoutId = (await app.history(userId))[0]!.workout.id;
    const before = await app.historyDetails(sessionToken, workoutId);
    await query("update planned_exercises set planned_set_count=99,rep_target_min=99,rep_target_max=99");
    await query("update workout_session_templates set name='Changed template'");
    await query("update exercise_identities set display_name='Renamed identity' where display_name='Incline Dumbbell Press'");
    await restart(); expect((await app.historyDetails(sessionToken, workoutId)).exercises).toEqual(before.exercises);
    expect((await app.historyDetails(sessionToken, workoutId)).sets).toEqual(before.sets);
  });

  it("owner isolation applies to exact history, records, resume and finish", async () => {
    await send("45x10"); const active = (await app.activeWorkout(userId))!;
    const other = await app.signUp("other-us5@example.com", "correct horse battery staple");
    const identity = (await query("select id from exercise_identities where display_name='Incline Dumbbell Press'"))[0].id;
    expect(await app.previousPerformance(other.userId, identity, "LB", "PER_HAND_PER_SIDE")).toBeNull();
    expect((await app.personalRecords(other.userId, identity, "LB", "PER_HAND_PER_SIDE")).highestLoad).toBeNull();
    await expect(app.workoutLifecycle({ sessionToken: other.sessionToken, workoutId: active.id, intent: "RESUME", idempotencyKey: "foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(app.workoutLifecycle({ sessionToken: other.sessionToken, workoutId: active.id, intent: "COMPLETE", idempotencyKey: "foreign" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("high-confidence AI finish cannot silently complete partial work or invent metrics", async () => {
    await send("45x10");
    mock.enqueue({ schemaVersion: "workout-action.v1", action: { type: "FINISH_WORKOUT", requestedCompletion: "COMPLETE" }, confidence: "high", requiresClarification: false, rationaleCodes: [], forbiddenDirectMutation: true });
    expect((await send("I'm finished for now")).body).toContain("Unfinished work remains");
    expect(await app.history(userId)).toHaveLength(0); expect(mock.requests).toHaveLength(1);
    await send("save completed"); expect(mock.requests).toHaveLength(1);
  });

  it("concurrent completion cannot advance the cursor twice", async () => {
    await send("45x10,45x9,45x8");
    const results = await Promise.allSettled([send("done", "finish-a"), send("done", "finish-b")]);
    // Both inbound messages recover successfully; only one durable completion is permitted.
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(2);
    expect(await app.history(userId)).toHaveLength(1); expect(await cursor()).toBe(1);
    expect(await query("select id from command_executions where command_type='FINISH_WORKOUT'")).toHaveLength(1);
  });

  it("the most recent exact occurrence wins when an exercise is added twice in one workout", async () => {
    await send("45x10"); await send("add Incline Dumbbell Press today"); await send("45x8"); await send("save incomplete");
    await restart();
    expect((await prior())?.map(set => set.reps)).toEqual([8]);
    expect((await records()).highestRepsAtLoad[0]?.reps).toBe(10);
  });
});
