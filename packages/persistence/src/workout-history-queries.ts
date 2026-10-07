import type { Pool, PoolClient } from "pg";
import type { LoadSemantics, WeightUnit } from "../../contracts/src/domain/enums.js";
import { resolveExerciseIdentity } from "../../domain/src/exercises/unknown-exercise-flow.js";
import { personalRecords } from "../../analytics/src/personal-record-service.js";
import { previousPerformance, type PerformanceSet } from "../../analytics/src/previous-performance-service.js";
import { DomainError } from "./store.js";

export class WorkoutHistoryQueries {
  constructor(private readonly db: Pool | PoolClient) {}

  async identity(userId: string, reference: string): Promise<string | null> {
    const identities = await this.db.query("select e.id,e.display_name as name from exercise_identities e join users u on u.id=$1 and u.deleted_at is null where (e.owner_user_id=$1 or e.owner_user_id is null) and e.merged_into_id is null", [userId]);
    const aliases = await this.db.query("select exercise_identity_id as \"identityId\",alias_text as alias from exercise_aliases where user_id=$1 and status='CONFIRMED'", [userId]);
    const result = resolveExerciseIdentity(reference, identities.rows, aliases.rows.filter(row => identities.rows.some(identity => identity.id === row.identityId)));
    if (result.status === "CONFLICT") throw new DomainError("Which exact exercise identity do you mean?", "INVALID_INPUT");
    return result.status === "KNOWN" ? result.id : null;
  }

  async sets(userId: string, exerciseIdentityId?: string): Promise<PerformanceSet[]> {
    const result = await this.db.query(`select s.*,w.status as workout_status,min(s.created_at) over (partition by s.session_exercise_id) as occurred_at
      from workout_sets s join workout_sessions w on w.id=s.workout_session_id and w.user_id=s.user_id
      join users u on u.id=s.user_id and u.deleted_at is null
      where s.user_id=$1 and ($2::text is null or s.exercise_identity_id=$2) and s.status='RECORDED'
      and w.status in ('COMPLETED','INCOMPLETE')`, [userId, exerciseIdentityId ?? null]);
    return result.rows.map(row => ({ id: row.id, userId: row.user_id, workoutId: row.workout_session_id,
      sessionExerciseId: row.session_exercise_id, exerciseIdentityId: row.exercise_identity_id,
      workoutStatus: row.workout_status, status: row.status, occurredAt: row.occurred_at, setIndex: row.set_index,
      loadValue: Number(row.load_value), weightUnit: row.weight_unit, loadSemantics: row.load_semantics, reps: row.reps }));
  }

  async previous(userId: string, exerciseRef: string, weightUnit: WeightUnit, loadSemantics: LoadSemantics, excludeWorkoutId?: string) {
    const exerciseIdentityId = await this.identity(userId, exerciseRef);
    if (!exerciseIdentityId) return null;
    return previousPerformance(await this.sets(userId, exerciseIdentityId), {
      userId, exerciseIdentityId, weightUnit, loadSemantics, ...(excludeWorkoutId ? { excludeWorkoutId } : {})
    });
  }

  async records(userId: string, exerciseRef: string, weightUnit: WeightUnit, loadSemantics: LoadSemantics) {
    const exerciseIdentityId = await this.identity(userId, exerciseRef);
    return personalRecords(exerciseIdentityId ? await this.sets(userId, exerciseIdentityId) : [], {
      userId, exerciseIdentityId: exerciseIdentityId ?? "", weightUnit, loadSemantics
    });
  }
}
