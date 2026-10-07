import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DomainError } from "./store.js";
import { WorkoutLifecycle } from "./workout-lifecycle.js";

export class WorkoutSelection {
  constructor(private readonly db: PoolClient, private readonly userId: string) {}
  async active() { return (await this.db.query("select * from workout_sessions where user_id=$1 and status in ('PROPOSED','ACTIVE','PAUSED') for update", [this.userId])).rows[0]; }
  async target(routineRef?: string, sessionRef?: string) {
    const rows = (await this.db.query(`select t.id,t.name,t.routine_id,r.name as routine_name,r.version as routine_version,c.id as cursor_id,c.version as cursor_version,c.next_session_template_id
      from workout_session_templates t join routines r on r.id=t.routine_id join routine_sequence_cursors c on c.routine_id=r.id and c.user_id=r.user_id
      where r.user_id=$1 and r.archived_at is null and t.archived_at is null
      and ($2::text is null or r.id=$2 or lower(r.name)=lower($2))
      and (($3::text is null and t.id=c.next_session_template_id) or t.id=$3 or lower(t.name)=lower($3)) order by r.created_at,t.sequence_index`, [this.userId, routineRef ?? null, sessionRef ?? null])).rows;
    return rows.length === 1 ? { template: rows[0] } : { clarification: rows.length ? `Which routine/session? ${rows.map(row => `${row.routine_name}: ${row.name}`).join("; ")}` : "No matching planned workout. Configure or choose an exact routine/session." };
  }
  async create(templateId: string, status: "PROPOSED" | "ACTIVE") {
    if (await this.active()) throw new DomainError("Workout already active", "ACTIVE_WORKOUT");
    const template = (await this.db.query(`select t.*,r.version as routine_version,c.next_session_template_id from workout_session_templates t join routines r on r.id=t.routine_id
      join routine_sequence_cursors c on c.routine_id=r.id and c.user_id=r.user_id where t.id=$1 and r.user_id=$2 and t.archived_at is null and r.archived_at is null`, [templateId, this.userId])).rows[0];
    if (!template) throw new DomainError("Session not found", "NOT_FOUND");
    const planned = (await this.db.query(`select p.*,e.display_name from planned_exercises p join exercise_identities e on e.id=p.exercise_identity_id
      where p.session_template_id=$1 and p.removed_at is null order by p.order_index`, [templateId])).rows;
    if (!planned.length) throw new DomainError("Configure planned exercises first", "EMPTY_SESSION");
    const id = randomUUID();
    await this.db.query(`insert into workout_sessions(id,user_id,routine_id,session_template_id,template_snapshot,name,status,sequence_progression_policy,started_at,proposal_routine_version)
      values($1,$2,$3,$4,$5,$6,$7,$8,case when $7='ACTIVE' then clock_timestamp() else null end,$9)`,
    [id, this.userId, template.routine_id, template.id, JSON.stringify(planned), template.name, status, template.next_session_template_id === template.id ? "ADVANCE_NORMAL_SEQUENCE" : "DO_NOT_ADVANCE_NORMAL_SEQUENCE", template.routine_version]);
    for (const [index, exercise] of planned.entries()) {
      const exerciseId = randomUUID();
      await this.db.query(`insert into session_exercises(id,workout_session_id,exercise_identity_id,source_planned_exercise_id,order_index,status,planned_set_count_snapshot,rep_target_min_snapshot,rep_target_max_snapshot,exercise_name_snapshot)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [exerciseId, id, exercise.exercise_identity_id, exercise.id, index, index === 0 ? "IN_PROGRESS" : "PLANNED", exercise.planned_set_count, exercise.rep_target_min, exercise.rep_target_max, exercise.display_name]);
      if (index === 0) await this.db.query("update workout_sessions set active_session_exercise_id=$2 where id=$1", [id, exerciseId]);
    }
    return this.active();
  }
  async describe() {
    const workout = await this.active();
    if (!workout) return "No proposed workout.";
    const exercises = (await this.db.query("select exercise_name_snapshot,planned_set_count_snapshot,rep_target_min_snapshot,rep_target_max_snapshot from session_exercises where workout_session_id=$1 and status not in ('SKIPPED','REPLACED','DELETED') order by order_index", [workout.id])).rows;
    return `${workout.status === "PROPOSED" ? "Proposed" : "Started"} ${workout.name}\n${exercises.map((row, index) => `${index + 1}. ${row.exercise_name_snapshot}: ${row.planned_set_count_snapshot ?? "unplanned"} sets, ${row.rep_target_min_snapshot ?? "unspecified"}${row.rep_target_max_snapshot !== row.rep_target_min_snapshot ? `-${row.rep_target_max_snapshot}` : ""} reps`).join("\n")}\n${await new WorkoutLifecycle(this.db, this.userId).context()}${workout.status === "PROPOSED" ? "\nStart planned, change exercises today, choose another session, or rest." : ""}`;
  }
  async start(routineRef?: string, sessionRef?: string) {
    const active = await this.active();
    if (active) return active.status === "PROPOSED" ? this.describe() : `${active.name} is already active. Resume, finish, save incomplete, discard, or replace?`;
    const result = await this.target(routineRef, sessionRef);
    if ("clarification" in result) return result.clarification;
    await this.create(result.template.id, "PROPOSED"); return this.describe();
  }
  async accept() {
    const workout = await this.active();
    if (!workout) return "Request a workout proposal first.";
    if (workout.status !== "PROPOSED") return `${workout.name} is already active. Resume, finish, save incomplete, discard, or replace?`;
    const routine = (await this.db.query("select version from routines where id=$1 and user_id=$2 and archived_at is null", [workout.routine_id, this.userId])).rows[0];
    if (!routine || routine.version !== workout.proposal_routine_version) return "Routine changed. Rest to dismiss this proposal, then request a fresh workout.";
    await this.db.query("update workout_sessions set status='ACTIVE',started_at=clock_timestamp(),version=version+1 where id=$1 and user_id=$2", [workout.id, this.userId]);
    return this.describe();
  }
  async choose(sessionRef: string) {
    const active = await this.active();
    if (active && active.status !== "PROPOSED") return "An active workout exists. Explicitly request replace workout with the named session, then confirm.";
    const result = await this.target(undefined, sessionRef);
    if ("clarification" in result) return result.clarification;
    if (active) await this.db.query("update workout_sessions set status='CANCELLED_REPLACED',active_session_exercise_id=null,version=version+1 where id=$1 and user_id=$2", [active.id, this.userId]);
    await this.create(result.template.id, "PROPOSED"); return this.describe();
  }
  async rest() {
    const active = await this.active();
    if (active && active.status !== "PROPOSED") return "A workout is active. Continue, save incomplete, or explicitly discard it.";
    if (active) await this.db.query("update workout_sessions set status='DISCARDED',discarded_at=clock_timestamp(),active_session_exercise_id=null,version=version+1 where id=$1 and user_id=$2", [active.id, this.userId]);
    return "Rest recorded. The normal routine sequence is unchanged.";
  }
  async replace(workoutId: string, templateId: string) {
    const active = await this.active();
    if (!active || active.id !== workoutId) throw new DomainError("Workout changed", "STALE_VERSION");
    await this.db.query("update workout_sessions set status='CANCELLED_REPLACED',active_session_exercise_id=null,version=version+1 where id=$1 and user_id=$2", [workoutId, this.userId]);
    await this.create(templateId, "ACTIVE"); return this.describe();
  }
}
