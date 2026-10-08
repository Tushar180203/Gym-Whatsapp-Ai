import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { MockStructuredOutputClient } from "../../packages/ai/src/testing/mock-structured-output-client.js";
import { StructuredIntentInterpreter } from "../../packages/ai/src/structured-intent-interpreter.js";
import { StaticPromptRegistry } from "../../packages/ai/src/prompt-registry.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/index.js";
import type { ProposedAction } from "../../packages/contracts/src/ai/actions.js";
import { hashChallenge } from "../../packages/messaging/src/whatsapp/link-challenge.js";

const url = process.env.TEST_DATABASE_URL;
const pgDescribe = url || process.env.REQUIRE_POSTGRES_TESTS === "1" ? describe : describe.skip;
pgDescribe("US4 PostgreSQL application boundary", () => {
  let app: PostgresVerticalSliceApp, userId: string, mock: MockStructuredOutputClient, next: number, scopedUrl: string;
  beforeEach(async () => {
    if (!url) throw new Error("TEST_DATABASE_URL required");
    const admin = new Pool({ connectionString: url });
    await admin.query("drop schema if exists us4_test cascade");
    await admin.query("create schema us4_test"); await admin.end();
    const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=us4_test"); scopedUrl = parsed.toString();
    mock = new MockStructuredOutputClient();
    app = new PostgresVerticalSliceApp({ connectionString: scopedUrl, interpreter: new StructuredIntentInterpreter(mock, new StaticPromptRegistry("mock")) });
    await app.migrate(); next = 0;
    userId = (await app.signUp("us4@example.com", "correct horse battery staple")).userId;
    await app.setPreferredWeightUnit(userId, "LB"); await app.createRoutine(userId);
    await send(`link ${await app.createLinkToken(userId, hashChallenge("15555550123"))}`); await send("start"); await send("start planned");
  });
  afterEach(async () => { await app?.close(); });
  function propose(action: ProposedAction) {
    mock.enqueue({ schemaVersion: "workout-action.v1", action, confidence: "high", requiresClarification: false, rationaleCodes: [], forbiddenDirectMutation: true });
  }
  async function send(text: string, messageId = `us4-${next++}`, crash = false) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business-1", changes: [{ value: { metadata: { phone_number_id: "phone-1" }, messages: [{ id: messageId, from: "15555550123", text: { body: text } }] } }] }] });
    const adapter = new WhatsAppInboundAdapter("secret");
    return app.processInbound(adapter.normalize(raw, adapter.sign(raw))[0]!, { crashAfterCommandBeforeOutbound: crash });
  }
  async function query(sql: string, args: unknown[] = []) { return (await app.pool.query(sql, args)).rows; }

  it("correction and audit survive restart, duplicate webhooks and crash recovery", async () => {
    await send("45 LB x 10");
    await send("actually that was 9", "correction-once", true);
    await Promise.all([send("actually that was 9", "correction-once"), send("actually that was 9", "correction-once")]);
    expect(await query("select reps,load_semantics,weight_unit from workout_sets")).toEqual([{ reps: 9, load_semantics: "PER_HAND_PER_SIDE", weight_unit: "LB" }]);
    const audit = await query("select before_snapshot,after_snapshot from corrections where type='CORRECT_SET'");
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ before_snapshot: { reps: 10 }, after_snapshot: { reps: 9 } });
    await send("finish"); await send("save completed"); await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scopedUrl });
    expect((await app.history(userId))[0]?.sets[0]).toMatchObject({ reps: 9, weightUnit: "LB", loadSemantics: "PER_HAND_PER_SIDE" });
    expect(await query("select before_snapshot,after_snapshot from corrections where type='CORRECT_SET'")).toEqual(audit);
    expect(mock.requests).toHaveLength(0);
  });

  it("named ordinal corrections work after switching; ambiguous correction cannot mutate", async () => {
    await send("45x10,45x8"); await send("add Squat today"); await send("80x5");
    await send("incline set 2 was actually 10");
    expect((await query("select reps from workout_sets order by created_at,set_index")).map(row => row.reps)).toEqual([10, 10, 5]);
    propose({ type: "CORRECT_SET", targetRef: "incline", replacement: { reps: 9 } });
    expect((await send("incline was 9")).body).toContain("Which");
    expect((await query("select count(*)::int as n from corrections where type='CORRECT_SET'"))[0].n).toBe(1);
    await send("switch to Incline Dumbbell Press");
    expect((await query("select status from session_exercises order by order_index")).map(row => row.status)).toEqual(["IN_PROGRESS", "IN_PROGRESS"]);
  });

  it("session changes stay isolated; permanent confirmation changes only future templates once", async () => {
    const before = await query("select * from planned_exercises order by id");
    await send("add Squat today"); await send("do Squat first"); await send("skip Squat today");
    await send("switch to Incline Dumbbell Press"); await send("replace Incline Dumbbell Press with Squat today");
    expect(await query("select * from planned_exercises order by id")).toEqual(before);
    const sessionBefore = await query("select * from session_exercises order by id");
    expect((await send("replace Squat with Incline Dumbbell Press")).body).toBe("Today only or update your routine?");
    propose({ type: "UPDATE_ROUTINE_REQUEST", scope: "PERMANENT_ROUTINE", requestedChange: { operation: "REPLACE_EXERCISE", sessionRef: "Upper", fromExerciseRef: "Incline Dumbbell Press", toExerciseRef: "Squat" } });
    expect((await send("from now on use squat in Upper instead of incline")).body).toContain("Reply yes");
    expect(await query("select * from planned_exercises order by id")).toEqual(before);
    await send("yes", "confirm-permanent", true); await send("yes", "confirm-permanent"); await send("confirm");
    expect(await query("select * from session_exercises order by id")).toEqual(sessionBefore);
    expect((await query("select count(*)::int as n from corrections where type='PERMANENT_EXERCISE'"))[0].n).toBe(1);
    expect((await query("select e.display_name from planned_exercises p join exercise_identities e on e.id=p.exercise_identity_id join workout_session_templates t on t.id=p.session_template_id where t.name='Upper'"))[0].display_name).toBe("Squat");
    expect(mock.requests).toHaveLength(1);
  });

  it("custom exercises require confirmation; confirmed aliases reuse; conflicts clarify", async () => {
    expect((await send("add Red chest machine today")).body).toContain("create custom exercise");
    expect(await query("select id from exercise_identities where display_name='Red chest machine'")).toHaveLength(0);
    await send("yes"); await send("45x10");
    const custom = (await query("select id from exercise_identities where display_name='Red chest machine'"))[0].id;
    propose({ type: "MAP_EXERCISE_ALIAS", alias: "red press", exerciseRef: "Red chest machine" });
    await send("call Red chest machine red press"); await send("confirm");
    await send("switch to Incline Dumbbell Press"); await send("switch to red press");
    expect((await query("select se.exercise_identity_id from workout_sessions w join session_exercises se on se.id=w.active_session_exercise_id"))[0].exercise_identity_id).toBe(custom);
    propose({ type: "CORRECT_SET", targetRef: "exercise:red press:set:1", replacement: { reps: 11 } });
    expect((await send("red press first set should be 11 reps")).body).toContain("applied");
    expect((await query("select reps from workout_sets where exercise_identity_id=$1", [custom]))[0].reps).toBe(11);
    propose({ type: "MAP_EXERCISE_ALIAS", alias: "red press", exerciseRef: "Squat" });
    expect((await send("call Squat red press")).body).toContain("conflicts");
    await send("add Smith Incline Press today"); await send("yes");
    expect(await query("select id from exercise_identities where display_name in ('Incline Dumbbell Press','Smith Incline Press')")).toHaveLength(2);
  });

  it("last deletion is direct; older/completed/bulk targets require confirmation", async () => {
    await send("45x10,45x9,45x8"); expect((await send("delete last set")).body).toContain("applied");
    expect((await send("delete incline set 1")).body).toContain("Reply yes"); await send("no");
    expect((await query("select count(*)::int as n from workout_sets where status='RECORDED'"))[0].n).toBe(2);
    await send("finish"); await send("save completed"); const target = (await query("select id from workout_sets where set_index=1"))[0].id;
    propose({ type: "CORRECT_SET", targetRef: target, replacement: { reps: 12 } });
    expect((await send("completed set 1 was 12")).body).toContain("Reply yes"); await send("yes");
    expect((await app.history(userId))[0]?.sets[0]?.reps).toBe(12);
    expect((await send("completed incline set 2 was actually 8")).body).toContain("Reply yes");
    await send("yes"); expect((await app.history(userId))[0]?.sets[1]?.reps).toBe(8);
    expect((await send("delete history all")).body).toContain("Reply yes"); await send("confirm");
    expect(await app.history(userId)).toHaveLength(0);
  });

  it("expiry/stale/conflict/no-pending and invented numeric values fail safely", async () => {
    expect((await send("yes")).body).toBe("No pending confirmation.");
    await send("45x10,45x9"); await send("delete incline set 1");
    expect((await send("add New press today")).body).toContain("Resolve the pending");
    await send("45x8"); expect((await send("yes")).body).toContain("target changed");
    await send("delete incline set 1"); await query("update pending_confirmations set expires_at=now()-interval '1 minute' where status='PENDING'");
    expect((await send("yes")).body).toContain("expired");
    propose({ type: "CORRECT_SET", replacement: { reps: 99 } });
    expect((await send("make the last one 7 reps please")).body).toContain("explicitly");
    expect(await query("select id from corrections where type='CORRECT_SET'")).toHaveLength(0);
  });

  it("unknown named set logging confirms identity once and preserves supplied values", async () => {
    expect((await send("Red press machine 45 lb x 10")).body).toContain("Reply yes");
    expect(await query("select id from workout_sets")).toHaveLength(0);
    await send("confirm"); await send("confirm");
    expect(await query("select load_value::float8 as load,weight_unit,load_semantics,reps from workout_sets")).toEqual([{ load: 45, weight_unit: "LB", load_semantics: "UNSPECIFIED_DEFAULT", reps: 10 }]);
    await send("Red press machine 40 kg x 9");
    expect(await query("select id from exercise_identities where display_name='Red press machine'")).toHaveLength(1);
    expect(await query("select id from workout_sets")).toHaveLength(2);
    expect(mock.requests).toHaveLength(0);
  });

  it("scope replies are resolved deterministically before AI and still gate permanent changes", async () => {
    expect((await send("replace incline with Squat")).body).toBe("Today only or update your routine?");
    const routineBefore = await query("select * from planned_exercises order by id");
    expect((await send("today only")).body).toContain("applied");
    expect(await query("select * from planned_exercises order by id")).toEqual(routineBefore);
    await send("add Squat"); expect((await send("update my routine")).body).toContain("Reply yes");
    expect(await query("select * from planned_exercises order by id")).toEqual(routineBefore);
    await send("yes");
    expect(await query("select id from planned_exercises")).toHaveLength(3);
    expect(mock.requests).toHaveLength(0);
  });

  it("identity merges are explicitly confirmed and preserve set records and audit", async () => {
    await send("45x10"); await send("add Smith Incline Press today"); await send("yes"); await send("45x9");
    const ids = await query("select id from workout_sets order by set_index,id");
    const before = await query("select exercise_identity_id from workout_sets order by id");
    expect(new Set(before.map(row => row.exercise_identity_id)).size).toBe(2);
    expect((await send("merge identity Smith Incline Press into Incline Dumbbell Press")).body).toContain("Reply yes");
    expect(await query("select exercise_identity_id from workout_sets order by id")).toEqual(before);
    await send("confirm"); await send("yes");
    expect(await query("select id from workout_sets order by set_index,id")).toEqual(ids);
    expect(new Set((await query("select exercise_identity_id from workout_sets")).map(row => row.exercise_identity_id)).size).toBe(1);
    expect(await query("select id from corrections where type='MERGE_IDENTITIES'")).toHaveLength(1);
  });

  it("permanent add/reorder/remove mutate only future planned exercises after confirmation", async () => {
    const sessionBefore = await query("select * from session_exercises order by id");
    for (const change of [
      { operation: "ADD_EXERCISE", sessionRef: "Upper", exerciseRef: "Squat" },
      { operation: "REORDER_EXERCISE", sessionRef: "Upper", exerciseRef: "Squat", newOrderRef: "first" },
      { operation: "REMOVE_EXERCISE", sessionRef: "Upper", exerciseRef: "Incline Dumbbell Press" }
    ] as const) {
      propose({ type: "UPDATE_ROUTINE_REQUEST", scope: "PERMANENT_ROUTINE", requestedChange: change });
      const before = await query("select * from planned_exercises order by id");
      expect((await send(`permanently ${change.operation} in Upper`)).body).toContain("Reply yes");
      expect(await query("select * from planned_exercises order by id")).toEqual(before);
      await send("yes");
    }
    expect(await query("select * from session_exercises order by id")).toEqual(sessionBefore);
    const future = await query("select e.display_name,p.order_index from planned_exercises p join exercise_identities e on e.id=p.exercise_identity_id join workout_session_templates t on t.id=p.session_template_id where t.name='Upper' and p.removed_at is null");
    expect(future).toEqual([{ display_name: "Squat", order_index: 0 }]);
    await send("45x10"); await send("finish"); await send("save completed"); await send("start"); await send("start planned"); await send("80x5,80x5,80x5"); await send("finish"); await send("start"); await send("start planned");
    const active = await app.activeWorkout(userId);
    expect((await query("select e.display_name from session_exercises se join exercise_identities e on e.id=se.exercise_identity_id where se.workout_session_id=$1", [active!.id])).map(row => row.display_name)).toEqual(["Squat"]);
  });

  it("cross-user target IDs cannot authorize edits or confirmation; deleted users are blocked", async () => {
    await send("45x10,45x9");
    const other = await app.signUp("other@example.com", "correct horse battery staple");
    const target = (await query("select id from workout_sets order by set_index"))[0].id;
    const { Us4Commands } = await import("../../packages/persistence/src/us4.js");
    const client = await app.pool.connect();
    try {
      await client.query("begin");
      const foreign = new Us4Commands(client, other.userId, null);
      expect(await foreign.dispatch({ type: "CORRECT_SET", targetRef: target, replacement: { reps: 12 } }, "12", "foreign-key")).toContain("Which");
      expect(await foreign.resolveConfirmation("yes")).toBe("No pending confirmation.");
      await client.query("commit");
    } finally { client.release(); }
    await send("delete incline set 1");
    await query("update users set deleted_at=now() where id=$1", [userId]);
    await expect(send("yes")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await query("select id from corrections")).toHaveLength(0);
  });
  it("concurrent same-user messages retain a safely ordered correction target", async () => {
    const defaultValue = await query("select pg_get_expr(d.adbin,d.adrelid) as expression from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='workout_sets'::regclass and a.attname='created_at'");
    expect(defaultValue[0].expression).toContain("clock_timestamp()");
    await send("add Squat today");
    await Promise.all([send("Incline Dumbbell Press 45x10"), send("Squat 80x5")]);
    const before = await query("select id,reps from workout_sets order by created_at,set_index");
    expect(before).toHaveLength(2);
    await send("actually that was 9");
    expect((await query("select target_id from corrections where type='CORRECT_SET'"))[0].target_id).toBe(before[1].id);
    expect((await query("select reps from workout_sets where id=$1", [before[0].id]))[0].reps).toBe(before[0].reps);
    expect((await query("select reps from workout_sets where id=$1", [before[1].id]))[0].reps).toBe(9);
  });
});
