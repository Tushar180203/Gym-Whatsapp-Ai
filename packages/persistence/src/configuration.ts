import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { aliasRequestSchema, customExerciseSchema, exerciseRenameSchema, profilePatchSchema, routineConfigurationSchema } from "../../contracts/src/api/configuration.js";
import { DomainError } from "./store.js";
import { Us4Commands } from "./us4.js";
import { z } from "zod";
import { WhatsAppLinks, queuePlanReady } from "./whatsapp-links.js";

export type ConfiguredExercise = { id: string; displayName: string; defaultLoadSemantics: string; version: number; aliases: string[]; custom: boolean };
export type ConfiguredRoutine = {
  id: string; name: string; version: number;
  schedule: { intendedWorkoutsPerWeek?: number; plannedDays: string[] };
  sessions: Array<{ id: string; name: string; sequenceIndex: number; exercises: Array<{ exerciseIdentityId: string; plannedSetCount: number; repTargetMin: number; repTargetMax: number }> }>;
};

// The application supplies one authenticated, owner-locked PostgreSQL transaction.
export class Configuration {
  constructor(private readonly db: PoolClient, private readonly userId: string) {}
  async profile(input: unknown) {
    const value = profilePatchSchema.parse(input);
    await this.db.query(`insert into user_profiles(id,user_id,preferred_weight_unit,display_name) values($1,$2,$3,$4)
      on conflict(user_id) do update set preferred_weight_unit=excluded.preferred_weight_unit,
      display_name=case when $5 then excluded.display_name else user_profiles.display_name end`,
    [randomUUID(), this.userId, value.preferredWeightUnit, value.displayName ?? null, value.displayName !== undefined]);
    await this.db.query("update user_profiles set time_zone=coalesce($2,time_zone),conversation_memory_enabled=coalesce($3,conversation_memory_enabled),workout_reminders_enabled=coalesce($4,workout_reminders_enabled) where user_id=$1", [this.userId, value.timeZone ?? null, value.conversationMemoryEnabled ?? null, value.workoutRemindersEnabled ?? null]);
    if (value.conversationMemoryEnabled === false) await this.db.query("delete from conversation_turns where user_id=$1", [this.userId]);
    const row = (await this.db.query("select preferred_weight_unit,display_name,time_zone,conversation_memory_enabled,workout_reminders_enabled from user_profiles where user_id=$1", [this.userId])).rows[0];
    return { preferredWeightUnit: row.preferred_weight_unit, displayName: row.display_name, timeZone: row.time_zone, conversationMemoryEnabled: row.conversation_memory_enabled, workoutRemindersEnabled: row.workout_reminders_enabled };
  }
  async exercises(): Promise<ConfiguredExercise[]> {
    return (await this.db.query(`select e.id,e.display_name as "displayName",e.default_load_semantics as "defaultLoadSemantics",e.version,
      coalesce((select jsonb_agg(a.alias_text order by a.alias_text) from exercise_aliases a where a.exercise_identity_id=e.id and a.user_id=$1 and a.status='CONFIRMED'),'[]') as aliases,
      e.owner_user_id is not null as custom from exercise_identities e where (e.owner_user_id=$1 or e.owner_user_id is null) and e.merged_into_id is null order by e.display_name,e.id`, [this.userId])).rows;
  }
  async rename(exerciseId: string, input: unknown) {
    const value = exerciseRenameSchema.parse(input);
    const owned = (await this.db.query("select id,version from exercise_identities where id=$1 and owner_user_id=$2 and merged_into_id is null", [exerciseId, this.userId])).rows[0];
    if (!owned) throw new DomainError("Exercise not found", "NOT_FOUND");
    if (owned.version !== value.expectedVersion) throw new DomainError("Exercise changed", "STALE_VERSION");
    await this.db.query("update exercise_identities set display_name=$3,version=version+1 where id=$1 and owner_user_id=$2", [exerciseId, this.userId, value.displayName]);
    return (await this.exercises()).find(exercise => exercise.id === exerciseId);
  }
  async customExercise(input: unknown) {
    const value = customExerciseSchema.parse(input);
    await this.requireNoPending();
    const existing = (await this.exercises()).filter(exercise => exercise.displayName.toLowerCase() === value.name.toLowerCase());
    if (existing.length) return { clarification: "That name already exists. Choose the confirmed identity or a distinct name." };
    const commands = new Us4Commands(this.db, this.userId, null, "WEB");
    const body = await commands.dispatch({ type: "CREATE_CUSTOM_EXERCISE", name: value.name }, value.name, `web:custom:${randomUUID()}`);
    if (!body.includes("Reply yes/confirm")) return { clarification: body };
    await commands.resolveConfirmation("confirm");
    const exercise = (await this.exercises()).find(row => row.custom && row.displayName === value.name);
    if (!exercise) throw new DomainError("Exercise unavailable", "NOT_FOUND");
    await this.db.query("update exercise_identities set default_load_semantics=$2 where id=$1 and owner_user_id=$3", [exercise.id, value.defaultLoadSemantics, this.userId]);
    return { ...exercise, defaultLoadSemantics: value.defaultLoadSemantics };
  }
  async alias(exerciseId: string, input: unknown) {
    const value = aliasRequestSchema.parse(input);
    const target = (await this.exercises()).find(exercise => exercise.id === exerciseId);
    if (!target) throw new DomainError("Exercise not found", "NOT_FOUND");
    if (target.aliases.some((alias: string) => alias.toLowerCase() === value.alias.toLowerCase())) return target;
    await this.requireNoPending();
    const commands = new Us4Commands(this.db, this.userId, null, "WEB");
    const body = await commands.dispatch({ type: "MAP_EXERCISE_ALIAS", exerciseRef: exerciseId, alias: value.alias }, value.alias, `web:alias:${randomUUID()}`);
    if (!body.includes("Reply yes/confirm")) return { clarification: body };
    await commands.resolveConfirmation("confirm");
    return (await this.exercises()).find(exercise => exercise.id === exerciseId);
  }
  async merge(input: unknown) {
    const value = z.object({ fromExerciseId: z.string().min(1), toExerciseId: z.string().min(1), confirm: z.literal(true) }).strict().parse(input);
    const owned = (await this.exercises()).filter(exercise => exercise.custom && [value.fromExerciseId, value.toExerciseId].includes(exercise.id));
    if (owned.length !== 2 || value.fromExerciseId === value.toExerciseId) throw new DomainError("Exercise not found", "NOT_FOUND");
    await this.requireNoPending();
    const commands = new Us4Commands(this.db, this.userId, null, "WEB");
    const body = await commands.dispatch({ type: "MERGE_IDENTITIES", fromExerciseRef: value.fromExerciseId, toExerciseRef: value.toExerciseId }, "explicit identity merge", `web:merge:${randomUUID()}`);
    if (!body.includes("Reply yes/confirm")) return { clarification: body };
    return { body: await commands.resolveConfirmation("confirm") };
  }
  private async requireNoPending() {
    await this.db.query("update pending_confirmations set status='EXPIRED' where user_id=$1 and status='PENDING' and expires_at<=clock_timestamp()", [this.userId]);
    if ((await this.db.query("select id from pending_confirmations where user_id=$1 and status='PENDING'", [this.userId])).rows.length) throw new DomainError("Resolve the pending change first", "PENDING_CONFIRMATION");
  }
  async routines() {
    const ids = (await this.db.query("select id from routines where user_id=$1 and archived_at is null order by created_at,id", [this.userId])).rows;
    return Promise.all(ids.map(row => this.routine(row.id)));
  }
  async routine(routineId: string): Promise<ConfiguredRoutine> {
    const routine = (await this.db.query("select id,name,version,schedule_metadata as schedule from routines where id=$1 and user_id=$2 and archived_at is null", [routineId, this.userId])).rows[0];
    if (!routine) throw new DomainError("Routine not found", "NOT_FOUND");
    const sessions = (await this.db.query(`select t.id,t.name,t.sequence_index as "sequenceIndex",coalesce(jsonb_agg(jsonb_build_object(
      'exerciseIdentityId',p.exercise_identity_id,'plannedSetCount',p.planned_set_count,'repTargetMin',p.rep_target_min,'repTargetMax',p.rep_target_max)
      order by p.order_index) filter(where p.id is not null),'[]') as exercises from workout_session_templates t
      left join planned_exercises p on p.session_template_id=t.id and p.removed_at is null where t.routine_id=$1 and t.archived_at is null group by t.id order by t.sequence_index`, [routineId])).rows;
    return { ...routine, sessions };
  }
  async saveRoutine(input: unknown, routineId?: string) {
    const value = routineConfigurationSchema.parse(input);
    const existing = routineId ? await this.routine(routineId) : undefined;
    if (existing && value.expectedVersion !== existing.version) throw new DomainError("Routine changed", "STALE_VERSION");
    if (!existing && value.sessions.some(session => session.id)) throw new DomainError("New routine cannot reference existing sessions", "INVALID_SESSION");
    const available = new Set((await this.exercises()).map(exercise => exercise.id));
    if (value.sessions.some(session => session.exercises.some(exercise => !available.has(exercise.exerciseIdentityId)))) throw new DomainError("Exercise not found", "NOT_FOUND");
    if (existing && value.sessions.some(session => session.id && !existing.sessions.some((prior: { id: string }) => prior.id === session.id))) throw new DomainError("Session not found", "NOT_FOUND");
    if (existing) {
      const beforeIds = existing.sessions.map(session => session.id), requestedIds = value.sessions.map(session => session.id);
      const sequenceChanged = beforeIds.length !== requestedIds.length || requestedIds.some((id, index) => id !== beforeIds[index]);
      if (sequenceChanged && !value.confirmSequenceChange) throw new DomainError("Confirm the permanent sequence change", "CONFIRMATION_REQUIRED");
      if (sequenceChanged && requestedIds.length === beforeIds.length && requestedIds.every(id => id && beforeIds.includes(id))) {
        await this.requireNoPending();
        const commands = new Us4Commands(this.db, this.userId, null, "WEB");
        for (const [index, id] of requestedIds.entries()) {
          const body = await commands.dispatch({ type: "UPDATE_ROUTINE_REQUEST", scope: "PERMANENT_ROUTINE", requestedChange: { operation: "REORDER_SESSION", sessionRef: id!, newOrderRef: String(index + 1) } }, "permanently reorder routine sessions", `web:sequence:${randomUUID()}`);
          if (!body.includes("Reply yes/confirm")) throw new DomainError("Sequence target changed", "STALE_VERSION");
          await commands.resolveConfirmation("confirm");
        }
      }
    }
    const id = routineId ?? randomUUID();
    if (existing) await this.db.query("update routines set name=$3,schedule_metadata=$4,version=version+1 where id=$1 and user_id=$2", [id, this.userId, value.name, JSON.stringify(value.schedule)]);
    else await this.db.query("insert into routines(id,user_id,name,schedule_metadata) values($1,$2,$3,$4)", [id, this.userId, value.name, JSON.stringify(value.schedule)]);
    const cursor = (await this.db.query("select next_session_template_id from routine_sequence_cursors where routine_id=$1 and user_id=$2", [id, this.userId])).rows[0];
    // Keep referenced historical templates; move old positions out of the new sequence's range.
    await this.db.query("update workout_session_templates set archived_at=clock_timestamp(),sequence_index=sequence_index+100000 where routine_id=$1", [id]);
    const ids: string[] = [];
    for (const [index, session] of value.sessions.entries()) {
      const templateId = session.id ?? randomUUID(); ids.push(templateId);
      if (session.id) await this.db.query("update workout_session_templates set name=$2,sequence_index=$3,archived_at=null where id=$1 and routine_id=$4", [templateId, session.name, index, id]);
      else await this.db.query("insert into workout_session_templates(id,routine_id,name,sequence_index) values($1,$2,$3,$4)", [templateId, id, session.name, index]);
      await this.db.query("update planned_exercises set removed_at=clock_timestamp() where session_template_id=$1 and removed_at is null", [templateId]);
      const nextOrder = Number((await this.db.query("select coalesce(max(order_index),-1)+1 as n from planned_exercises where session_template_id=$1", [templateId])).rows[0].n);
      for (const [order, exercise] of session.exercises.entries()) await this.db.query(`insert into planned_exercises(id,session_template_id,exercise_identity_id,order_index,planned_set_count,rep_target_min,rep_target_max)
        values($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), templateId, exercise.exerciseIdentityId, nextOrder + order, exercise.plannedSetCount, exercise.repTargetMin, exercise.repTargetMax ?? exercise.repTargetMin]);
    }
    const nextId = cursor && ids.includes(cursor.next_session_template_id) ? cursor.next_session_template_id : ids[0]!;
    await this.db.query(`insert into routine_sequence_cursors(id,routine_id,user_id,next_session_template_id,cursor_sequence_index) values($1,$2,$3,$4,$5)
      on conflict(routine_id) do update set next_session_template_id=excluded.next_session_template_id,cursor_sequence_index=excluded.cursor_sequence_index,version=routine_sequence_cursors.version+1`, [randomUUID(), id, this.userId, nextId, ids.indexOf(nextId)]);
    await queuePlanReady(this.db, this.userId);
    return this.routine(id);
  }
  async archiveRoutine(routineId: string, input: unknown) {
    z.object({ confirm: z.literal(true), expectedVersion: z.number().int().positive() }).strict().parse(input);
    const value = input as { expectedVersion: number };
    const routine = await this.routine(routineId);
    if (value.expectedVersion !== routine.version) throw new DomainError("Routine changed", "STALE_VERSION");
    if ((await this.db.query("select id from workout_sessions where routine_id=$1 and user_id=$2 and status in ('PROPOSED','ACTIVE','PAUSED')", [routineId, this.userId])).rows.length) throw new DomainError("Finish the active workout first", "ACTIVE_WORKOUT");
    await this.db.query("update routines set archived_at=clock_timestamp(),version=version+1 where id=$1 and user_id=$2", [routineId, this.userId]);
    return { archived: true };
  }
  async links() {
    return new WhatsAppLinks(this.db, this.userId).status();
  }
  async revokeLink(linkId: string, input: unknown) {
    z.object({ confirm: z.literal(true) }).strict().parse(input);
    return new WhatsAppLinks(this.db, this.userId).revoke(linkId);
  }
}
