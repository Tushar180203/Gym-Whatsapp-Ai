import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { requiresCompletionChoice, type CompletionIntent } from "../../domain/src/workouts/completion-policy.js";
import { formatCompletionSummary, formatPreviousPerformance, semanticLabel } from "../../domain/src/workouts/workout-response.js";
import { personalRecords } from "../../analytics/src/personal-record-service.js";
import { WorkoutHistoryQueries } from "./workout-history-queries.js";
import { DomainError } from "./store.js";

const completionChoices = "Unfinished work remains. Save completed, save incomplete, continue, or discard?";
const emptyChoices = "No recorded sets. Save incomplete, continue, or discard?";

// Called inside the existing owner-authorized, per-user serialized transaction.
export class WorkoutLifecycle {
  constructor(private readonly db: PoolClient, private readonly userId: string, private readonly surface: "WEB" | "WHATSAPP" = "WHATSAPP") {}

  private async active(workoutId?: string) {
    const row = (await this.db.query("select * from workout_sessions where user_id=$1 and status in ('ACTIVE','PAUSED','PROPOSED') and ($2::text is null or id=$2) for update", [this.userId, workoutId ?? null])).rows[0];
    if (!row) throw new DomainError("No active workout", "NO_ACTIVE_WORKOUT");
    return row;
  }

  async context(): Promise<string> {
    const row = (await this.db.query(`select w.id as workout_id,se.exercise_identity_id,se.exercise_name_snapshot,
      se.planned_set_count_snapshot,se.rep_target_min_snapshot,se.rep_target_max_snapshot,e.display_name,e.default_load_semantics,
      p.preferred_weight_unit from workout_sessions w join session_exercises se on se.id=w.active_session_exercise_id
      join exercise_identities e on e.id=se.exercise_identity_id join user_profiles p on p.user_id=w.user_id
      where w.user_id=$1 and w.status in ('ACTIVE','PAUSED','PROPOSED')`, [this.userId])).rows[0];
    if (!row) return "";
    const current = (await this.db.query("select weight_unit,load_semantics from workout_sets where workout_session_id=$1 and exercise_identity_id=$2 and status='RECORDED' order by created_at desc,set_index desc limit 1", [row.workout_id, row.exercise_identity_id])).rows[0];
    const previous = await new WorkoutHistoryQueries(this.db).previous(this.userId, row.exercise_identity_id,
      current?.weight_unit ?? row.preferred_weight_unit, current?.load_semantics ?? row.default_load_semantics, row.workout_id);
    return formatPreviousPerformance(row.exercise_name_snapshot ?? row.display_name, row.planned_set_count_snapshot, row.rep_target_min_snapshot, row.rep_target_max_snapshot, previous);
  }

  async resume(workoutId?: string): Promise<string> {
    const workout = await this.active(workoutId);
    if (workout.status !== "ACTIVE" || workout.completion_choice_pending) await this.db.query("update workout_sessions set status='ACTIVE',started_at=coalesce(started_at,now()),completion_choice_pending=false,version=version+1 where id=$1 and user_id=$2", [workout.id, this.userId]);
    return `Resumed ${workout.name}\n${await this.context()}`.trim();
  }

  async finish(key: string, intent: CompletionIntent | "REQUEST", workoutId?: string): Promise<string> {
    const prior = (await this.db.query("select result_summary from command_executions where user_id=$1 and idempotency_key=$2 and status='COMPLETED'", [this.userId, key])).rows[0];
    if (prior) return prior.result_summary.body;
    const workout = await this.active(workoutId);
    if (intent === "CONTINUE") {
      const body = await this.resume(workout.id);
      await this.storeResult(key, "CONTINUE_WORKOUT", body);
      return body;
    }
    const progress = (await this.db.query(`select se.status,se.planned_set_count_snapshot,se.skipped_set_count,
      count(s.id)::int as recorded_sets from session_exercises se left join workout_sets s on s.session_exercise_id=se.id and s.user_id=$2 and s.status='RECORDED'
      where se.workout_session_id=$1 group by se.id`, [workout.id, this.userId])).rows;
    const count = progress.reduce((total, row) => total + row.recorded_sets, 0);
    const unfinished = requiresCompletionChoice(progress.map(row => ({ status: row.status, plannedSets: row.planned_set_count_snapshot, skippedSets: row.skipped_set_count, recordedSets: row.recorded_sets })), count);
    if ((intent === "REQUEST" && unfinished) || (intent === "COMPLETE" && count === 0)) {
      await this.db.query("update workout_sessions set completion_choice_pending=true where id=$1 and user_id=$2", [workout.id, this.userId]);
      const body = count === 0 ? emptyChoices : completionChoices;
      await this.storeResult(key, "FINISH_CHOICE", body);
      return body;
    }
    if (intent === "DISCARD" && !workout.completion_choice_pending) {
      await this.db.query("update workout_sessions set completion_choice_pending=true where id=$1 and user_id=$2", [workout.id, this.userId]);
      const body = "Discard this workout? Reply discard workout to confirm, or continue.";
      await this.storeResult(key, "FINISH_CHOICE", body);
      return body;
    }
    const completion = intent === "REQUEST" ? "COMPLETE" : intent;
    const status = completion === "COMPLETE" ? "COMPLETED" : completion === "INCOMPLETE" ? "INCOMPLETE" : "DISCARDED";
    await this.db.query(`update workout_sessions set status=$2,completion_intent=$3,completion_choice_pending=false,
      completed_at=case when $2<>'DISCARDED' then now() else null end,
      discarded_at=case when $2='DISCARDED' then now() else null end,
      duration_seconds=case when started_at is null then null else greatest(0,floor(extract(epoch from (now()-started_at))))::int end,
      active_session_exercise_id=null,version=version+1 where id=$1 and user_id=$4`, [workout.id, status, completion, this.userId]);
    if (status === "COMPLETED" && workout.sequence_progression_policy === "ADVANCE_NORMAL_SEQUENCE") {
      // A stale/off-sequence completion cannot reset the normal rotation.
      const cursor = (await this.db.query("select next_session_template_id from routine_sequence_cursors where routine_id=$1 and user_id=$2 for update", [workout.routine_id, this.userId])).rows[0];
      if (cursor?.next_session_template_id === workout.session_template_id) {
        const templates = (await this.db.query("select id,sequence_index from workout_session_templates where routine_id=$1 order by sequence_index", [workout.routine_id])).rows;
        const index = templates.findIndex(row => row.id === workout.session_template_id);
        const next = templates[(index + 1) % templates.length];
        if (next) await this.db.query("update routine_sequence_cursors set next_session_template_id=$1,cursor_sequence_index=$2 where routine_id=$3 and user_id=$4", [next.id, next.sequence_index, workout.routine_id, this.userId]);
      }
    }
    const body = status === "DISCARDED" ? `${workout.name}: discarded` : await this.summary(workout.id);
    const commandId = await this.storeResult(key, "FINISH_WORKOUT", body);
    if (status === "DISCARDED") await this.db.query("insert into corrections(id,user_id,workout_session_id,type,target_type,target_id,before_snapshot,after_snapshot,source_surface,command_id) values($1,$2,$3,'DISCARD_WORKOUT','WORKOUT_SESSION',$3,$4,$5,$6,$7)", [randomUUID(), this.userId, workout.id, JSON.stringify({ status: workout.status }), JSON.stringify({ status }), this.surface, commandId]);
    return body;
  }

  private async storeResult(key: string, type: string, body: string): Promise<string> {
    const commandId = randomUUID();
    await this.db.query("insert into command_executions(id,user_id,command_type,idempotency_key,status,result_summary,applied_at) values($1,$2,$3,$4,'COMPLETED',$5,now())", [commandId, this.userId, type, key, JSON.stringify({ body })]);
    return commandId;
  }

  async summary(workoutId: string): Promise<string> {
    const workout = (await this.db.query("select name,status,duration_seconds from workout_sessions where id=$1 and user_id=$2 and status in ('COMPLETED','INCOMPLETE')", [workoutId, this.userId])).rows[0];
    if (!workout) throw new DomainError("Workout not found", "NOT_FOUND");
    const sets = await new WorkoutHistoryQueries(this.db).sets(this.userId);
    const current = sets.filter(set => set.workoutId === workoutId);
    const records: string[] = [];
    const groups = new Map(current.map(set => [`${set.exerciseIdentityId}:${set.weightUnit}:${set.loadSemantics}`, set]));
    for (const set of groups.values()) {
      const query = { userId: this.userId, exerciseIdentityId: set.exerciseIdentityId, weightUnit: set.weightUnit, loadSemantics: set.loadSemantics };
      const all = personalRecords(sets.filter(row => row.workoutId === workoutId || row.occurredAt <= set.occurredAt), query);
      const prior = personalRecords(sets.filter(row => row.workoutId !== workoutId && row.occurredAt <= set.occurredAt), query);
      const name = (await this.db.query("select coalesce(se.exercise_name_snapshot,e.display_name) as name from session_exercises se join exercise_identities e on e.id=se.exercise_identity_id where se.id=$1 and se.workout_session_id=$2", [set.sessionExerciseId, workoutId])).rows[0]?.name;
      const label = `${set.weightUnit} ${semanticLabel(set.loadSemantics)}`;
      if (all.highestLoad?.workoutId === workoutId && all.highestLoad.loadValue > (prior.highestLoad?.loadValue ?? -1)) records.push(`${name} ${all.highestLoad.loadValue} ${label}`);
      for (const best of all.highestRepsAtLoad.filter(row => row.workoutId === workoutId)) {
        if (best.reps > (prior.highestRepsAtLoad.find(row => row.loadValue === best.loadValue)?.reps ?? -1)) records.push(`${name} ${best.loadValue} ${label} x ${best.reps}`);
      }
    }
    return formatCompletionSummary({ name: workout.name, status: workout.status, exercises: new Set(current.map(set => set.sessionExerciseId)).size, sets: current.length, durationSeconds: workout.duration_seconds, records });
  }
}
