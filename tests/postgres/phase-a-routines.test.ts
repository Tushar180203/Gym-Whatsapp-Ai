import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";

const url = process.env.TEST_DATABASE_URL;
const pgDescribe = url || process.env.REQUIRE_POSTGRES_TESTS === "1" ? describe : describe.skip;

pgDescribe("Phase A routine transaction integrity", () => {
  let app: PostgresVerticalSliceApp;
  let owner: string;
  beforeEach(async () => {
    if (!url) throw new Error("TEST_DATABASE_URL required");
    const admin = new Pool({ connectionString: url });
    await admin.query("drop schema if exists phase_a_routines_test cascade");
    await admin.query("create schema phase_a_routines_test");
    await admin.end();
    const parsed = new URL(url);
    parsed.searchParams.set("options", "-c search_path=phase_a_routines_test");
    app = new PostgresVerticalSliceApp({ connectionString: parsed.toString() });
    await app.migrate();
    owner = (await app.signUp("routine-owner@example.com", "correct horse battery staple")).userId;
  });
  afterEach(async () => { await app?.close(); });

  async function failPlannedExercisesFor(userId: string) {
    await app.pool.query("create table failing_routine_owners(user_id text primary key)");
    await app.pool.query("insert into failing_routine_owners values($1)", [userId]);
    await app.pool.query(`create function reject_test_plan() returns trigger language plpgsql as $$
      begin
        if exists(select 1 from workout_session_templates t join routines r on r.id=t.routine_id
          join failing_routine_owners f on f.user_id=r.user_id where t.id=new.session_template_id)
        then raise exception 'test-only planned exercise failure'; end if;
        return new;
      end $$;
      create trigger reject_test_plan before insert on planned_exercises
      for each row execute function reject_test_plan()`);
  }

  it("creates the complete routine atomically", async () => {
    const poolQuery = vi.spyOn(app.pool, "query");
    const routineId = await app.createRoutine(owner);
    expect(poolQuery).not.toHaveBeenCalled();
    poolQuery.mockRestore();
    expect((await app.pool.query("select * from routines where id=$1", [routineId])).rows).toHaveLength(1);
    expect((await app.pool.query("select * from workout_session_templates where routine_id=$1", [routineId])).rows).toHaveLength(2);
    expect((await app.pool.query("select * from planned_exercises")).rows).toHaveLength(2);
    expect((await app.pool.query("select * from routine_sequence_cursors where routine_id=$1", [routineId])).rows).toHaveLength(1);
  });

  it("rolls back a midway failure without orphan identities or sessions", async () => {
    await failPlannedExercisesFor(owner);
    await expect(app.createRoutine(owner)).rejects.toThrow("test-only planned exercise failure");
    for (const table of ["routines", "exercise_identities", "workout_session_templates", "planned_exercises", "routine_sequence_cursors"]) {
      expect((await app.pool.query(`select count(*)::int as n from ${table}${table === "exercise_identities" ? " where owner_user_id is not null" : ""}`)).rows[0].n).toBe(0);
    }
  });

  it("isolates concurrent successful and failing routine transactions", async () => {
    const failing = (await app.signUp("routine-failure@example.com", "correct horse battery staple")).userId;
    await failPlannedExercisesFor(failing);
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => app.createRoutine(index % 2 ? failing : owner)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(4);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(4);
    expect((await app.pool.query("select user_id,count(*)::int as n from routines group by user_id")).rows).toEqual([{ user_id: owner, n: 4 }]);
    expect((await app.pool.query("select count(*)::int as n from exercise_identities where owner_user_id is not null")).rows[0].n).toBe(8);
    expect((await app.pool.query("select count(*)::int as n from workout_session_templates")).rows[0].n).toBe(8);
    expect((await app.pool.query("select count(*)::int as n from planned_exercises")).rows[0].n).toBe(8);
    expect((await app.pool.query("select count(*)::int as n from routine_sequence_cursors")).rows[0].n).toBe(4);
  });
});
