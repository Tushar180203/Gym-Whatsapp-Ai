import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";

const url = process.env.TEST_DATABASE_URL;
const pgDescribe = url || process.env.REQUIRE_POSTGRES_TESTS === "1" ? describe : describe.skip;
pgDescribe("Phase A owner-scoped configuration", () => {
  let app: PostgresVerticalSliceApp, owner: { userId: string; sessionToken: string }, other: typeof owner, scoped: string;
  beforeEach(async () => {
    if (!url) throw new Error("TEST_DATABASE_URL required");
    const admin = new Pool({ connectionString: url });
    await admin.query("drop schema if exists phase_a_configuration_test cascade");
    await admin.query("create schema phase_a_configuration_test"); await admin.end();
    const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=phase_a_configuration_test"); scoped = parsed.toString();
    app = new PostgresVerticalSliceApp({ connectionString: scoped }); await app.migrate();
    owner = await app.signUp("setup-owner@example.com", "correct horse battery staple");
    other = await app.signUp("setup-other@example.com", "correct horse battery staple");
  });
  afterEach(async () => { await app?.close(); });
  it("duplicate signup fails safely without changing the existing account/session", async () => {
    await expect(app.signUp("SETUP-OWNER@example.com", "different correct battery staple")).rejects.toMatchObject({ code: "SIGNUP_UNAVAILABLE" });
    expect(await app.currentUser(owner.sessionToken)).toBe(owner.userId);
    expect((await app.pool.query("select count(*)::int as n from users")).rows[0].n).toBe(2);
    expect((await app.pool.query("select count(*)::int as n from auth_sessions")).rows[0].n).toBe(2);
  });
  it("session persistence failure rolls back account creation", async () => {
    await app.pool.query("create function reject_signup_session() returns trigger language plpgsql as $$ begin raise exception 'test session failure'; end $$");
    await app.pool.query("create trigger signup_session_failure before insert on auth_sessions for each row execute function reject_signup_session()");
    try {
      await expect(app.signUp("rollback@example.com", "correct horse battery staple")).rejects.toThrow("test session failure");
      expect((await app.pool.query("select count(*)::int as n from users")).rows[0].n).toBe(2);
      expect((await app.pool.query("select count(*)::int as n from auth_sessions")).rows[0].n).toBe(2);
    } finally {
      await app.pool.query("drop trigger signup_session_failure on auth_sessions");
    }
  });
  const routineInput = () => ({ name: "My rotation", schedule: { intendedWorkoutsPerWeek: 3, plannedDays: ["MON", "WED", "FRI"] }, sessions: [
    { name: "Push", exercises: [{ exerciseIdentityId: "global_barbell_bench_press", plannedSetCount: 3, repTargetMin: 8, repTargetMax: 10 }] },
    { name: "Legs", exercises: [{ exerciseIdentityId: "global_leg_extension", plannedSetCount: 2, repTargetMin: 10 }] }
  ] });
  it("round-trips profile preferences/name and rejects ignored/foreign fields", async () => {
    expect(await app.configure(owner.sessionToken, c => c.profile({ preferredWeightUnit: "LB", displayName: "Sam" }))).toEqual({ preferredWeightUnit: "LB", displayName: "Sam" });
    expect(await app.profile(owner.userId)).toEqual({ preferredWeightUnit: "LB", displayName: "Sam" });
    await app.configure(owner.sessionToken, c => c.profile({ preferredWeightUnit: "KG" }));
    expect((await app.profile(owner.userId)).displayName).toBe("Sam");
    await expect(app.configure(owner.sessionToken, c => c.profile({ preferredWeightUnit: "KG", userId: other.userId }))).rejects.toThrow();
  });
  it("saves multiple configurable routines and preserves schedule/cursor after restart", async () => {
    const first = await app.configure(owner.sessionToken, c => c.saveRoutine(routineInput()));
    await app.configure(owner.sessionToken, c => c.saveRoutine({ ...routineInput(), name: "Second rotation" }));
    expect(first.sessions.map(session => session.name)).toEqual(["Push", "Legs"]);
    expect(first.sessions[1]!.exercises[0]).toMatchObject({ plannedSetCount: 2, repTargetMin: 10, repTargetMax: 10 });
    await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scoped });
    const routines = await app.configure(owner.sessionToken, c => c.routines()); expect(routines).toHaveLength(2);
    expect(routines[0]!.schedule).toEqual(routineInput().schedule);
    const cursor = (await app.pool.query("select next_session_template_id from routine_sequence_cursors where routine_id=$1", [first.id])).rows[0];
    expect(cursor.next_session_template_id).toBe(first.sessions[0]!.id);
    expect(await app.configure(other.sessionToken, c => c.routines())).toEqual([]);
    await expect(app.configure(other.sessionToken, c => c.routine(first.id))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("confirms custom identity and aliases without merging; rename preserves identity", async () => {
    const custom = await app.configure(owner.sessionToken, c => c.customExercise({ name: "Red machine", confirm: true, defaultLoadSemantics: "MACHINE_STACK" }));
    expect(custom).toHaveProperty("id"); if (!("id" in custom)) throw new Error("Expected confirmed custom identity");
    const alias = await app.configure(owner.sessionToken, c => c.alias(custom.id, { alias: "red press", confirm: true }));
    expect(alias).toMatchObject({ id: custom.id, aliases: ["red press"] });
    expect(await app.configure(owner.sessionToken, c => c.alias(custom.id, { alias: "red press", confirm: true }))).toEqual(alias);
    expect(await app.configure(owner.sessionToken, c => c.alias("global_barbell_bench_press", { alias: "red press", confirm: true }))).toHaveProperty("clarification");
    await expect(app.configure(other.sessionToken, c => c.rename(custom.id, { displayName: "Other", expectedVersion: 1 }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(app.configure(owner.sessionToken, c => c.rename(custom.id, { displayName: "Red incline machine", expectedVersion: 1 }))).rejects.toMatchObject({ code: "STALE_VERSION" });
    const current = (await app.configure(owner.sessionToken, c => c.exercises())).find(exercise => exercise.id === custom.id)!;
    const renamed = await app.configure(owner.sessionToken, c => c.rename(custom.id, { displayName: "Red incline machine", expectedVersion: current.version }));
    expect(renamed).toMatchObject({ id: custom.id, displayName: "Red incline machine", aliases: ["red press"] });
    await expect(app.configure(other.sessionToken, c => c.saveRoutine({ ...routineInput(), sessions: [{ name: "Foreign", exercises: [{ exerciseIdentityId: custom.id, plannedSetCount: 3, repTargetMin: 8 }] }] }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(app.configure(owner.sessionToken, c => c.customExercise({ name: "Unconfirmed", defaultLoadSemantics: "TOTAL_LOAD" }))).rejects.toThrow();
  });
  it("rejects invalid plans and foreign template IDs atomically; stale edits cannot overwrite", async () => {
    await expect(app.configure(owner.sessionToken, c => c.saveRoutine({ ...routineInput(), sessions: [{ name: "Invalid", exercises: [{ exerciseIdentityId: "global_barbell_bench_press", plannedSetCount: 0, repTargetMin: 8 }] }] }))).rejects.toThrow();
    expect(await app.configure(owner.sessionToken, c => c.routines())).toEqual([]);
    const first = await app.configure(owner.sessionToken, c => c.saveRoutine(routineInput()));
    await expect(app.configure(owner.sessionToken, c => c.saveRoutine({ ...routineInput(), expectedVersion: 99 }, first.id))).rejects.toMatchObject({ code: "STALE_VERSION" });
    await expect(app.configure(owner.sessionToken, c => c.saveRoutine({ ...routineInput(), sessions: [{ ...routineInput().sessions[0], id: first.sessions[0]!.id }] }))).rejects.toMatchObject({ code: "INVALID_SESSION" });
    expect((await app.configure(owner.sessionToken, c => c.routine(first.id))).version).toBe(1);
  });
  it("web reorder uses existing confirmations and preserves captured workout snapshots", async () => {
    const first = await app.configure(owner.sessionToken, c => c.saveRoutine(routineInput()));
    await app.startNextWorkout(owner.userId);
    const workout = (await app.activeWorkout(owner.userId))!;
    const before = (await app.pool.query("select template_snapshot from workout_sessions where id=$1", [workout.id])).rows[0].template_snapshot;
    const changed = { ...routineInput(), expectedVersion: first.version, sessions: [...first.sessions].reverse().map(session => ({ id: session.id, name: `${session.name} revised`, exercises: session.exercises })) };
    await expect(app.configure(owner.sessionToken, c => c.saveRoutine(changed, first.id))).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    const updated = await app.configure(owner.sessionToken, c => c.saveRoutine({ ...changed, confirmSequenceChange: true }, first.id));
    expect(updated.sessions.map(session => session.id)).toEqual(first.sessions.map(session => session.id).reverse());
    expect((await app.pool.query("select template_snapshot from workout_sessions where id=$1", [workout.id])).rows[0].template_snapshot).toEqual(before);
    const cursor = (await app.pool.query("select next_session_template_id,cursor_sequence_index from routine_sequence_cursors where routine_id=$1", [first.id])).rows[0];
    expect(cursor).toMatchObject({ next_session_template_id: first.sessions[0]!.id, cursor_sequence_index: 1 });
    expect((await app.pool.query("select status from pending_confirmations where action_type='REORDER_SESSION'")).rows.every(row => row.status === "APPLIED")).toBe(true);
    await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scoped });
    expect((await app.configure(owner.sessionToken, c => c.routine(first.id))).sessions).toEqual(updated.sessions);
  });
  it("upgrades populated 0006 schema and preserves routines, identities and cursors", async () => {
    const admin = new Pool({ connectionString: url }); await admin.query("drop schema if exists phase_a_upgrade_test cascade"); await admin.query("create schema phase_a_upgrade_test"); await admin.end();
    const parsed = new URL(url!); parsed.searchParams.set("options", "-c search_path=phase_a_upgrade_test");
    const upgrade = new PostgresVerticalSliceApp({ connectionString: parsed.toString() });
    try {
      const { readFile } = await import("node:fs/promises");
      await upgrade.pool.query("create table schema_migrations(name text primary key)");
      for (const file of ["0001_vertical_slice.sql", "0002_us4.sql", "0003_us5.sql", "0004_us6.sql", "0005_us7.sql", "0006_release_integrity.sql"]) {
        await upgrade.pool.query(await readFile(`packages/persistence/migrations/${file}`, "utf8"));
        await upgrade.pool.query("insert into schema_migrations(name) values($1)", [file]);
      }
      const user = await upgrade.signUp("upgrade-a@example.com", "correct horse battery staple"); const id = await upgrade.createRoutine(user.userId);
      const cursor = (await upgrade.pool.query("select next_session_template_id from routine_sequence_cursors where routine_id=$1", [id])).rows[0];
      await upgrade.migrate(); await upgrade.migrate();
      expect((await upgrade.configure(user.sessionToken, c => c.routine(id))).sessions.map(session => session.name)).toEqual(["Upper", "Lower"]);
      expect((await upgrade.pool.query("select next_session_template_id,version from routine_sequence_cursors where routine_id=$1", [id])).rows[0]).toEqual({ ...cursor, version: 1 });
    } finally { await upgrade.close(); }
  });
  it("real configuration creation rolls back mid-plan failure and concurrent requests remain isolated", async () => {
    await app.pool.query("create function reject_phase_a_plan() returns trigger language plpgsql as $$ begin if new.exercise_identity_id='global_leg_extension' then raise exception 'test plan failure'; end if; return new; end $$");
    await app.pool.query("create trigger phase_a_failure before insert on planned_exercises for each row execute function reject_phase_a_plan()");
    await expect(app.configure(owner.sessionToken, c => c.saveRoutine(routineInput()))).rejects.toThrow("test plan failure");
    for (const table of ["routines", "routine_sequence_cursors", "workout_session_templates", "planned_exercises"]) expect((await app.pool.query(`select count(*)::int as n from ${table}`)).rows[0].n).toBe(0);
    await app.pool.query("drop trigger phase_a_failure on planned_exercises");
    const results = await Promise.all(Array.from({ length: 4 }, (_, index) => app.configure(owner.sessionToken, c => c.saveRoutine({ ...routineInput(), name: `Rotation ${index}` }))));
    expect(new Set(results.map(row => row.id)).size).toBe(4);
    expect(await app.configure(other.sessionToken, c => c.routines())).toEqual([]);
    expect((await app.pool.query("select count(*)::int as n from workout_session_templates")).rows[0].n).toBe(8);
    expect((await app.pool.query("select count(*)::int as n from routine_sequence_cursors")).rows[0].n).toBe(4);
  });
  it("completed history and identities remain unchanged by real routine/rename APIs", async () => {
    await app.configure(owner.sessionToken, c => c.profile({ preferredWeightUnit: "KG" }));
    const identity = await app.configure(owner.sessionToken, c => c.customExercise({ name: "Red press", confirm: true, defaultLoadSemantics: "TOTAL_LOAD" }));
    if (!("id" in identity)) throw new Error("Missing identity");
    const routine = await app.configure(owner.sessionToken, c => c.saveRoutine({ name: "Push plan", sessions: [{ name: "Push", exercises: [{ exerciseIdentityId: identity.id, plannedSetCount: 1, repTargetMin: 8 }] }] }));
    await app.startNextWorkout(owner.userId); const workout = (await app.activeWorkout(owner.userId))!;
    await app.recordWebSets(owner.sessionToken, workout.id, { notation: "45 kg x 8", expectedVersion: workout.version, idempotencyKey: "snapshot-set" });
    await app.workoutLifecycle({ sessionToken: owner.sessionToken, workoutId: workout.id, intent: "REQUEST", idempotencyKey: "snapshot-finish" });
    const before = await app.historyDetails(owner.sessionToken, workout.id);
    await app.configure(owner.sessionToken, c => c.rename(identity.id, { displayName: "Red chest press", expectedVersion: identity.version }));
    await app.configure(owner.sessionToken, c => c.saveRoutine({ name: "Revised plan", expectedVersion: routine.version, sessions: [{ id: routine.sessions[0]!.id, name: "Revised push", exercises: [{ exerciseIdentityId: identity.id, plannedSetCount: 4, repTargetMin: 10, repTargetMax: 12 }] }] }, routine.id));
    expect(await app.historyDetails(owner.sessionToken, workout.id)).toEqual(before);
    await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scoped });
    expect(await app.historyDetails(owner.sessionToken, workout.id)).toEqual(before);
    expect((await app.pool.query("select exercise_identity_id from workout_sets where workout_session_id=$1", [workout.id])).rows[0].exercise_identity_id).toBe(identity.id);
  });
  it("missing preferred unit fails clearly without persisting an invented unit or set", async () => {
    await app.configure(owner.sessionToken, c => c.saveRoutine(routineInput())); await app.startNextWorkout(owner.userId);
    const workout = (await app.activeWorkout(owner.userId))!;
    await expect(app.recordWebSets(owner.sessionToken, workout.id, { notation: "50x8", expectedVersion: workout.version, idempotencyKey: "no-profile" })).rejects.toMatchObject({ code: "PREFERRED_UNIT_REQUIRED" });
    expect((await app.pool.query("select id from workout_sets where user_id=$1", [owner.userId])).rows).toEqual([]);
  });
});
