import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { WorkoutHistoryQueries } from "./workout-history-queries.js";
import type { HistorySnapshot } from "../../analytics/src/history-question-service.js";
import { DomainError } from "./store.js";
export const classificationsSchema = z.object({ classifications: z.array(z.object({
  muscleGroup: z.string().trim().min(1).max(80), role: z.enum(["PRIMARY", "SECONDARY"]), status: z.enum(["CONFIRMED", "UNCERTAIN", "UNCLASSIFIED"])
}).strict()).max(20) }).strict().superRefine((value, ctx) => {
  const keys = value.classifications.map(row => `${row.muscleGroup.toLowerCase()}:${row.role}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Duplicate muscle classification" });
});
export class AnalyticsQueries {
  constructor(private readonly db: PoolClient, private readonly userId: string) {}
  async snapshot(now = new Date()): Promise<HistorySnapshot> {
    if (!(await this.db.query("select id from users where id=$1 and deleted_at is null", [this.userId])).rows.length) throw new DomainError("Unauthenticated", "UNAUTHENTICATED");
    const workouts = await this.db.query("select id,user_id as \"userId\",session_template_id as \"templateId\",name,status,coalesce(started_at,created_at) as \"trainedAt\" from workout_sessions where user_id=$1 and status in ('COMPLETED','INCOMPLETE')", [this.userId]);
    const identities = await this.db.query("select id,display_name as name,default_load_semantics as \"defaultLoadSemantics\" from exercise_identities where (owner_user_id=$1 or owner_user_id is null) and merged_into_id is null", [this.userId]);
    const aliases = await this.db.query("select a.exercise_identity_id as \"identityId\",a.alias_text as alias from exercise_aliases a join exercise_identities e on e.id=a.exercise_identity_id where a.user_id=$1 and a.status='CONFIRMED' and (e.owner_user_id=$1 or e.owner_user_id is null) and e.merged_into_id is null", [this.userId]);
    const classifications = await this.db.query("select user_id as \"userId\",exercise_identity_id as \"exerciseIdentityId\",muscle_group as \"muscleGroup\",role,status from exercise_muscle_classifications where user_id=$1", [this.userId]);
    const profile = (await this.db.query("select preferred_weight_unit from user_profiles where user_id=$1", [this.userId])).rows[0];
    if (!profile) throw new DomainError("Profile required", "PROFILE_REQUIRED");
    const sets = await new WorkoutHistoryQueries(this.db).sets(this.userId);
    const names = await this.db.query("select s.id,se.exercise_name_snapshot from workout_sets s join session_exercises se on se.id=s.session_exercise_id where s.user_id=$1 and s.status='RECORDED'", [this.userId]);
    return { userId: this.userId, now, preferredWeightUnit: profile.preferred_weight_unit, workouts: workouts.rows, identities: identities.rows, aliases: aliases.rows, classifications: classifications.rows, sets,
      setNames: Object.fromEntries(names.rows.filter(row => row.exercise_name_snapshot).map(row => [row.id, row.exercise_name_snapshot])) };
  }
  async classify(exerciseId: string, value: unknown): Promise<void> {
    const input = classificationsSchema.parse(value);
    const identity = (await this.db.query("select id from exercise_identities where id=$1 and (owner_user_id=$2 or owner_user_id is null) and merged_into_id is null for update", [exerciseId, this.userId])).rows[0];
    if (!identity) throw new DomainError("Exercise not found", "NOT_FOUND");
    await this.db.query("delete from exercise_muscle_classifications where user_id=$1 and exercise_identity_id=$2", [this.userId, exerciseId]);
    for (const row of input.classifications) await this.db.query("insert into exercise_muscle_classifications(id,user_id,exercise_identity_id,muscle_group,role,status,source,confirmed_by_user_id,confirmed_at) values($1,$2,$3,$4,$5,$6,'USER_CORRECTED',case when $6='CONFIRMED' then $2 else null end,case when $6='CONFIRMED' then now() else null end)", [randomUUID(), this.userId, exerciseId, row.muscleGroup, row.role, row.status]);
  }
}
