import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ProposedActionEnvelope, LoadSemantics, WeightUnit } from "../../contracts/src/index.js";
import { parseProposedActionEnvelope } from "../../contracts/src/ai/actions.js";
import { correctedSet, correctionNeedsConfirmation, type SetValues } from "../../domain/src/corrections/correction-command.js";
import { resolveCorrectionTarget, type SetTarget } from "../../domain/src/corrections/correction-target-resolver.js";
import { deletionNeedsConfirmation } from "../../domain/src/corrections/delete-command.js";
import { normalizeExerciseName, resolveExerciseIdentity } from "../../domain/src/exercises/unknown-exercise-flow.js";
import { reorderedIds } from "../../domain/src/workouts/session-mutation-commands.js";
import { routineChangePolicy } from "../../domain/src/routines/routine-change-request-service.js";
import type { Us4Action } from "../../domain/src/parser/us4-parser.js";
import { parseSetMessage } from "../../domain/src/parser/set-parser.js";
import { WorkoutSelection } from "./workout-selection.js";
import type { ReplaceWorkoutAction } from "../../domain/src/parser/us4-parser.js";
import { DomainError } from "./store.js";

type Row = Record<string, any>;
type Plan = { kind: string; args: Row; versions: Record<string, number>; confirm: boolean; summary: string };
type Prepared = Plan | { question: string };

// All calls run inside the existing inbound transaction and per-user advisory lock.
export class Us4Commands {
  constructor(private readonly db: PoolClient, private readonly userId: string, private readonly messageId: string | null, private readonly surface: "WEB" | "WHATSAPP" = "WHATSAPP") {}

  private async rows(sql: string, values: unknown[] = []): Promise<Row[]> { return (await this.db.query(sql, values)).rows; }
  private async authorize(): Promise<void> {
    if (!(await this.rows("select id from users where id=$1 and deleted_at is null", [this.userId]))[0]) throw new Error("User unavailable");
  }
  private async active(): Promise<Row | undefined> { return (await this.rows("select * from workout_sessions where user_id=$1 and status in ('ACTIVE','PAUSED','PROPOSED')", [this.userId]))[0]; }
  private async exercises(): Promise<Row[]> { return this.rows("select id, display_name as name, version from exercise_identities where (owner_user_id=$1 or owner_user_id is null) and merged_into_id is null", [this.userId]); }
  private async identity(ref: string): Promise<{ id: string } | { name: string } | { question: string }> {
    const identities = await this.exercises();
    const aliases = await this.rows("select exercise_identity_id as \"identityId\", alias_text as alias from exercise_aliases where user_id=$1 and status='CONFIRMED'", [this.userId]);
    const resolved = resolveExerciseIdentity(ref, identities.map(row => ({ id: row.id, name: row.name })), aliases.map(row => ({ identityId: row.identityId, alias: row.alias })));
    return resolved.status === "KNOWN" ? { id: resolved.id } : resolved.status === "CONFLICT" ? { question: "That alias conflicts with another exercise. Which identity do you mean?" } : { name: ref.trim() };
  }
  private async sessionExercise(workout: Row, reference?: string): Promise<Row | undefined> {
    const exercises = await this.rows("select se.*, e.display_name from session_exercises se join exercise_identities e on e.id=se.exercise_identity_id where se.workout_session_id=$1 and se.status not in ('REPLACED','DELETED') order by se.order_index", [workout.id]);
    if (!reference || reference === "current") return exercises.find(row => row.id === workout.active_session_exercise_id);
    const resolved = await this.identity(reference);
    const matches = exercises.filter(row => row.id === reference || ("id" in resolved && row.exercise_identity_id === resolved.id) || row.display_name.toLowerCase() === reference.toLowerCase() || row.display_name.toLowerCase().startsWith(`${reference.toLowerCase()} `));
    return matches.length === 1 ? matches[0] : undefined;
  }
  private async sets(): Promise<Array<Row & SetTarget>> {
    const rows = await this.rows(`select s.*, e.display_name, w.status as workout_status from workout_sets s join workout_sessions w on w.id=s.workout_session_id and w.user_id=s.user_id join exercise_identities e on e.id=s.exercise_identity_id where s.user_id=$1 and s.status='RECORDED' order by s.created_at,s.set_index`, [this.userId]);
    return rows.map(row => ({ ...row, id: row.id, workoutId: row.workout_session_id, exerciseId: row.exercise_identity_id, exerciseName: row.display_name, setIndex: row.set_index, workoutStatus: row.workout_status, createdAt: row.created_at.toISOString() }));
  }
  private async versions(workout?: Row, routine?: Row): Promise<Record<string, number>> {
    return { ...(workout ? { [`workout_sessions:${workout.id}`]: workout.version } : {}), ...(routine ? { [`routines:${routine.id}`]: routine.version } : {}) };
  }

  async dispatchEnvelope(value: ProposedActionEnvelope, input: string, key: string): Promise<string> {
    const envelope = parseProposedActionEnvelope(value);
    await this.authorize();
    if ("scope" in envelope.action && envelope.action.scope === "AMBIGUOUS") return this.scopeQuestion(envelope.action, input);
    if (envelope.requiresClarification || envelope.confidence === "low") return envelope.clarificationQuestion ?? "Please clarify the requested change.";
    return this.dispatch(envelope.action, input, key);
  }

  async dispatch(action: Us4Action | ReplaceWorkoutAction, input: string, key: string): Promise<string> {
    await this.authorize();
    const existing = (await this.rows("select result_summary from command_executions where user_id=$1 and idempotency_key=$2 and status='COMPLETED'", [this.userId, key]))[0];
    if (existing) return existing.result_summary.body;
    let prepared: Prepared;
    try { prepared = await this.prepare(action, input); } catch (error) {
      if (error instanceof Error && "code" in error) throw error;
      return error instanceof Error ? error.message : "Please clarify the change.";
    }
    if ("question" in prepared) {
      if ("scope" in action && action.scope === "AMBIGUOUS") return this.scopeQuestion(action, input);
      return prepared.question;
    }
    if (prepared.confirm) return this.propose(prepared);
    return this.execute(prepared, key);
  }

  private async prepare(action: Us4Action | ReplaceWorkoutAction, input: string): Promise<Prepared> {
    const workout = await this.active();
    if ("scope" in action && action.scope === "AMBIGUOUS") return { question: "Today only or update your routine?" };
    if (action.type === "REPLACE_WORKOUT") {
      if (!workout || workout.status === "PROPOSED") return { question: "Choose a proposed session, or start a workout before replacing an active one." };
      const target = await new WorkoutSelection(this.db, this.userId).target(undefined, action.sessionRef);
      if ("clarification" in target) return { question: target.clarification };
      return { kind: "REPLACE_WORKOUT", args: { workoutId: workout.id, templateId: target.template.id },
        versions: { ...await this.versions(workout), [`routines:${target.template.routine_id}`]: target.template.routine_version, [`routine_sequence_cursors:${target.template.cursor_id}`]: target.template.cursor_version },
        confirm: true, summary: `Replace ${workout.name} with ${target.template.name}` };
    }
    if (action.type === "UPDATE_ROUTINE_REQUEST" && action.requestedChange.operation === "REORDER_SESSION") {
      if (action.scope !== "PERMANENT_ROUTINE") return { question: "Today only or update your routine?" };
      const change = action.requestedChange;
      const templates = await this.rows("select t.*,r.version as routine_version from workout_session_templates t join routines r on r.id=t.routine_id where r.user_id=$1 and r.archived_at is null and t.archived_at is null and (t.id=$2 or lower(t.name)=lower($2))", [this.userId, change.sessionRef]);
      if (templates.length !== 1) return { question: "Which exact routine session do you mean?" };
      const target = templates[0]!, cursor = (await this.rows("select * from routine_sequence_cursors where routine_id=$1 and user_id=$2", [target.routine_id, this.userId]))[0]!;
      const sessions = await this.rows("select id from workout_session_templates where routine_id=$1 and archived_at is null order by sequence_index", [target.routine_id]);
      const ordinal = change.newOrderRef === "first" ? 1 : Number(change.newOrderRef);
      if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > sessions.length) return { question: "Choose a valid session position." };
      return { kind: "REORDER_SESSION", args: { routineId: target.routine_id, templateId: target.id, ordinal },
        versions: { [`routines:${target.routine_id}`]: target.routine_version, [`routine_sequence_cursors:${cursor.id}`]: cursor.version }, confirm: true, summary: `Reorder future routine session ${target.name} to position ${ordinal}` };
    }
    if (action.type === "CORRECT_SET" || action.type === "DELETE_SET") {
      const sets = await this.sets();
      let targetRef = action.targetRef;
      const named = targetRef?.match(/^(completed:)?exercise:(.+?)(:set:\d+|:last)$/i);
      if (named) {
        const identity = await this.identity(named[2]!);
        if ("question" in identity) return identity;
        if ("id" in identity) targetRef = `${named[1] ?? ""}exercise:${identity.id}${named[3]}`;
      }
      const resolved = resolveCorrectionTarget(sets, targetRef, workout?.id);
      if (resolved.status === "CLARIFY") return { question: resolved.question };
      const target = sets.find(row => row.id === resolved.target.id)!;
      const targetWorkout = (await this.rows("select * from workout_sessions where id=$1 and user_id=$2", [target.workoutId, this.userId]))[0]!;
      const before: SetValues = { loadValue: Number(target.load_value), weightUnit: target.weight_unit as WeightUnit, loadSemantics: target.load_semantics as LoadSemantics, reps: target.reps };
      const after = action.type === "CORRECT_SET" ? correctedSet(before, action.replacement, this.surface === "WEB" ? undefined : input) : { ...before, status: "DELETED" };
      const last = resolveCorrectionTarget(sets, "last-active-set", workout?.id);
      const directLast = action.targetRef === "last-active-set" && target.workoutId === workout?.id && last.status === "RESOLVED" && last.target.id === target.id;
      const summary = action.type === "CORRECT_SET" ? `Correct ${target.exerciseName} set ${target.setIndex}: ${before.loadValue} ${before.weightUnit} / ${before.loadSemantics} / ${before.reps} reps -> ${after.loadValue} ${after.weightUnit} / ${after.loadSemantics} / ${after.reps} reps` : `Delete ${target.exerciseName} set ${target.setIndex}`;
      return { kind: action.type, args: { targetId: target.id, workoutId: target.workoutId, before, after }, versions: await this.versions(targetWorkout), confirm: action.type === "CORRECT_SET" ? correctionNeedsConfirmation(target.workoutStatus, this.surface) : deletionNeedsConfirmation({ kind: "SET", isLastActiveSet: directLast }), summary };
    }
    if (action.type === "DELETE_GROUP") {
      const sets = await this.sets();
      let targets = sets.filter(set => action.kind === "HISTORY" ? ["COMPLETED", "INCOMPLETE"].includes(set.workoutStatus) && (action.reference === "all" || set.workoutId === action.reference) : action.kind === "WORKOUT" ? set.workoutId === (action.reference === "current" ? workout?.id : action.reference) : set.workoutId === workout?.id && (set.exerciseId === action.reference || set.exerciseName.toLowerCase() === action.reference.toLowerCase()));
      if (!targets.length) return { question: "Specify an owned workout or exercise with recorded sets." };
      const versions: Record<string, number> = {};
      for (const workoutId of new Set(targets.map(set => set.workoutId))) {
        const w = (await this.rows("select * from workout_sessions where id=$1 and user_id=$2", [workoutId, this.userId]))[0];
        Object.assign(versions, await this.versions(w));
      }
      return { kind: action.type, args: { ids: targets.map(set => set.id), groupKind: action.kind, workoutIds: [...new Set(targets.map(set => set.workoutId))] }, versions, confirm: true, summary: `Delete ${action.kind.toLowerCase()} (${targets.length} sets)` };
    }
    if (action.type === "CREATE_CUSTOM_EXERCISE" || action.type === "MAP_EXERCISE_ALIAS" || action.type === "MERGE_IDENTITIES") {
      if (action.type === "CREATE_CUSTOM_EXERCISE") {
        const existing = await this.identity(action.name);
        if ("question" in existing) return existing;
        for (const alias of action.aliases ?? []) {
          const resolved = await this.identity(alias);
          if ("question" in resolved || ("id" in resolved && (!("id" in existing) || existing.id !== resolved.id))) return { question: "That alias conflicts with another exercise. Choose a different alias." };
        }
        return { kind: action.type, args: { identity: existing, aliases: action.aliases ?? [] }, versions: {}, confirm: true, summary: `Confirm custom exercise ${action.name}` };
      }
      if (action.type === "MAP_EXERCISE_ALIAS") {
        const target = await this.identity(action.exerciseRef);
        if (!("id" in target)) return { question: "Choose an existing exercise identity for this alias." };
        const existing = await this.identity(action.alias);
        if ("question" in existing || ("id" in existing && existing.id !== target.id)) return { question: "That alias conflicts with another exercise. Choose a different alias." };
        return { kind: action.type, args: { identityId: target.id, alias: action.alias }, versions: await this.identityVersions([target.id]), confirm: true, summary: `Map ${action.alias} to ${action.exerciseRef}` };
      }
      const from = await this.identity(action.fromExerciseRef), to = await this.identity(action.toExerciseRef);
      if (!("id" in from) || !("id" in to) || from.id === to.id) return { question: "Choose two distinct existing user-owned exercise identities." };
      const owned = await this.rows("select id from exercise_identities where id=any($1::text[]) and owner_user_id=$2", [[from.id, to.id], this.userId]);
      if (owned.length !== 2) return { question: "Only your own exercise identities can be merged." };
      return { kind: action.type, args: { fromId: from.id, toId: to.id }, versions: await this.identityVersions([from.id, to.id]), confirm: true, summary: `Merge ${action.fromExerciseRef} into ${action.toExerciseRef}, including history` };
    }
    if (!workout) return { question: "Start or resume a workout before changing its exercises." };
    const routine = (await this.rows("select * from routines where id=$1 and user_id=$2", [workout.routine_id, this.userId]))[0]!;
    const versions = await this.versions(workout);
    if (action.type === "LOG_CONTEXT_SETS") {
      if (workout.status !== "ACTIVE") throw new DomainError("Start the proposed workout before logging", "NO_ACTIVE_WORKOUT");
      const identity = await this.identity(action.exerciseRef);
      if ("question" in identity) return identity;
      const profile = (await this.rows("select preferred_weight_unit from user_profiles where user_id=$1", [this.userId]))[0];
      if (!profile) return { question: "Set your preferred weight unit before logging." };
      const known = "id" in identity ? (await this.rows("select default_load_semantics from exercise_identities where id=$1", [identity.id]))[0] : undefined;
      const sets = parseSetMessage(action.setText, { preferredWeightUnit: profile.preferred_weight_unit, exerciseDefaultLoadSemantics: known?.default_load_semantics ?? "UNSPECIFIED_DEFAULT" });
      return { kind: action.type, args: { workoutId: workout.id, identity, sets }, versions, confirm: "name" in identity, summary: "name" in identity ? `Create custom exercise ${identity.name} and log the supplied sets today only` : "Log sets for confirmed exercise" };
    }
    if (action.type === "NEXT_EXERCISE") {
      const exercises = await this.rows("select * from session_exercises where workout_session_id=$1 and status not in ('SKIPPED','REPLACED','DELETED') order by order_index", [workout.id]);
      const index = exercises.findIndex(row => row.id === workout.active_session_exercise_id);
      const next = exercises[index + 1];
      if (!next) return { question: "No next planned exercise. Add or choose an exercise, or finish the workout." };
      return { kind: "CHANGE_ACTIVE_EXERCISE", args: { workoutId: workout.id, exerciseId: next.id }, versions, confirm: false, summary: "Changed active exercise" };
    }
    if (action.type === "SKIP_SET") return { kind: action.type, args: { workoutId: workout.id, exerciseId: workout.active_session_exercise_id }, versions, confirm: false, summary: "Skipped planned set" };
    if (action.type === "CHANGE_ACTIVE_EXERCISE" || action.type === "REORDER_EXERCISE") {
      const exercise = await this.sessionExercise(workout, action.exerciseRef);
      if (!exercise) return { question: "Which exercise in this workout do you mean?" };
      return { kind: action.type, args: { workoutId: workout.id, exerciseId: exercise.id, ...(action.type === "REORDER_EXERCISE" ? { ordinal: action.ordinal } : {}) }, versions, confirm: false, summary: "Changed active exercise" };
    }
    if (action.type === "SKIP_EXERCISE" || action.type === "REPLACE_EXERCISE" || action.type === "ADD_EXERCISE") {
      const permanent = action.scope === "PERMANENT_ROUTINE";
      const source = action.type === "ADD_EXERCISE" ? undefined : await this.sessionExercise(workout, action.type === "REPLACE_EXERCISE" ? action.fromExerciseRef : action.exerciseRef);
      if (action.type !== "ADD_EXERCISE" && !source) return { question: "Which exercise in this workout do you mean?" };
      const identity = action.type === "SKIP_EXERCISE" ? undefined : await this.identity(action.type === "REPLACE_EXERCISE" ? action.toExerciseRef : action.exerciseRef);
      if (identity && "question" in identity) return identity;
      if (permanent && action.type !== "ADD_EXERCISE" && !source?.source_planned_exercise_id) return { question: "Specify the future routine exercise to change, not a session-only addition." };
      return { kind: permanent ? "PERMANENT_EXERCISE" : action.type, args: { operation: action.type, workoutId: workout.id, routineId: routine.id, templateId: workout.session_template_id, sourceId: source?.id, plannedId: source?.source_planned_exercise_id, identity }, versions: permanent ? await this.versions(undefined, routine) : versions, confirm: permanent || !!(identity && "name" in identity), summary: `${permanent ? "Update routine" : "Change today only"}${identity && "name" in identity ? `; create custom exercise ${identity.name}` : ""}` };
    }
    if (action.type === "UPDATE_ROUTINE_REQUEST") {
      const change = action.requestedChange;
      if (routineChangePolicy(change, action.scope) === "CLARIFY") return { question: "Today only or update your routine?" };
      if (!change.operation.endsWith("EXERCISE")) return { question: "Session-template changes are not supported in this US4 pass." };
      if (!("sessionRef" in change)) return { question: "Specify the routine session." };
      const templates = await this.rows("select t.* from workout_session_templates t join routines r on r.id=t.routine_id where r.user_id=$1 and (t.id=$2 or lower(t.name)=lower($2) or ($2='current' and t.id=$3))", [this.userId, change.sessionRef, workout.session_template_id]);
      if (templates.length !== 1) return { question: "Which routine session do you mean?" };
      const template = templates[0]!;
      const r = (await this.rows("select * from routines where id=$1 and user_id=$2", [template.routine_id, this.userId]))[0]!;
      const reference = "fromExerciseRef" in change ? change.fromExerciseRef : "exerciseRef" in change ? change.exerciseRef : "";
      const sourceIdentity = await this.identity(reference);
      const planned = "id" in sourceIdentity ? await this.rows("select * from planned_exercises where session_template_id=$1 and exercise_identity_id=$2", [template.id, sourceIdentity.id]) : [];
      if (change.operation !== "ADD_EXERCISE" && planned.length !== 1) return { question: "Which planned exercise do you mean?" };
      const identity = change.operation === "REPLACE_EXERCISE" ? await this.identity(change.toExerciseRef) : change.operation === "ADD_EXERCISE" ? await this.identity(change.exerciseRef) : undefined;
      if (identity && "question" in identity) return identity;
      const ordinal = change.operation === "REORDER_EXERCISE" ? change.newOrderRef === "first" ? 1 : Number(change.newOrderRef) : undefined;
      const detail = change.operation === "REPLACE_EXERCISE" ? `${change.fromExerciseRef} -> ${change.toExerciseRef}` : change.operation === "REORDER_EXERCISE" ? `${change.exerciseRef} to ${change.newOrderRef}` : reference;
      return { kind: "PERMANENT_EXERCISE", args: { operation: change.operation, templateId: template.id, routineId: r.id, plannedId: planned[0]?.id, identity, ordinal }, versions: await this.versions(undefined, r), confirm: true, summary: `${change.operation.replaceAll("_", " ").toLowerCase()} in future ${template.name}: ${detail}${identity && "name" in identity ? `; create custom exercise ${identity.name}` : ""}` };
    }
    return { question: "This request is not supported yet." };
  }

  private async identityVersions(ids: string[]): Promise<Record<string, number>> {
    return Object.fromEntries((await this.rows("select id,version from exercise_identities where id=any($1::text[])", [ids])).map(row => [`exercise_identities:${row.id}`, row.version]));
  }
  private async scopeQuestion(action: Us4Action, input: string): Promise<string> {
    if (this.messageId) {
      const workout = await this.active();
      await this.db.query("update inbound_messages set clarification_action=$2 where id=$1 and user_id=$3", [this.messageId, JSON.stringify({ action, input, workoutId: workout?.id, version: workout?.version }), this.userId]);
    }
    return "Today only or update your routine?";
  }
  async resolveScopeClarification(input: string, key: string): Promise<string | undefined> {
    if (!/^(today only|today|session only|update (?:my |the |your )?routine|permanently)$/i.test(input.trim())) return undefined;
    const draft = (await this.rows("select * from inbound_messages where user_id=$1 and clarification_action is not null and clarification_resolved_at is null order by created_at desc limit 1 for update", [this.userId]))[0];
    if (!draft) return "No pending scope question. Specify the change again.";
    await this.db.query("update inbound_messages set clarification_resolved_at=now() where id=$1 and user_id=$2", [draft.id, this.userId]);
    const workout = await this.active();
    if (!workout || workout.id !== draft.clarification_action.workoutId || workout.version !== draft.clarification_action.version || Date.now() - draft.created_at.getTime() > 600000) return "Workout context changed or the question expired. Specify the change again.";
    const permanent = /routine|permanently/i.test(input);
    if (!permanent && draft.clarification_action.action.type === "UPDATE_ROUTINE_REQUEST") {
      const change = draft.clarification_action.action.requestedChange;
      if (!["current", workout.id, workout.session_template_id, workout.name].includes(change.sessionRef)) return "Specify a change for the current workout session.";
      let action: Us4Action;
      if (change.operation === "REPLACE_EXERCISE") action = { type: "REPLACE_EXERCISE", scope: "SESSION_ONLY", fromExerciseRef: change.fromExerciseRef, toExerciseRef: change.toExerciseRef };
      else if (change.operation === "ADD_EXERCISE") action = { type: "ADD_EXERCISE", scope: "SESSION_ONLY", exerciseRef: change.exerciseRef };
      else if (change.operation === "REMOVE_EXERCISE") action = { type: "SKIP_EXERCISE", scope: "SESSION_ONLY", exerciseRef: change.exerciseRef };
      else if (change.operation === "REORDER_EXERCISE") action = { type: "REORDER_EXERCISE", exerciseRef: change.exerciseRef, ordinal: change.newOrderRef === "first" ? 1 : Number(change.newOrderRef) };
      else return "Specify an exercise change for the current workout session.";
      return this.dispatch(action, draft.clarification_action.input, key);
    }
    const envelope = parseProposedActionEnvelope({ schemaVersion: "workout-action.v1", action: { ...draft.clarification_action.action, scope: permanent ? "PERMANENT_ROUTINE" : "SESSION_ONLY" }, confidence: "high", requiresClarification: false, rationaleCodes: [], forbiddenDirectMutation: true });
    return this.dispatch(envelope.action, draft.clarification_action.input, key);
  }
  private async propose(plan: Plan): Promise<string> {
    await this.db.query("update pending_confirmations set status='EXPIRED' where user_id=$1 and status='PENDING' and expires_at<=now()", [this.userId]);
    if ((await this.rows("select id from pending_confirmations where user_id=$1 and status='PENDING'", [this.userId])).length) return "Resolve the pending change with yes/confirm or no/cancel first.";
    await this.db.query("insert into pending_confirmations(id,user_id,action_type,proposed_action,summary,status,expires_at) values($1,$2,$3,$4,$5,'PENDING',now()+interval '10 minutes')", [randomUUID(), this.userId, plan.kind, JSON.stringify(plan), plan.summary]);
    return `${plan.summary}. Reply yes/confirm or no/cancel.`;
  }
  async resolveConfirmation(input: string): Promise<string | undefined> {
    if (!/^(yes|confirm|no|cancel)$/i.test(input.trim())) return undefined;
    await this.authorize();
    const pending = await this.rows("select * from pending_confirmations where user_id=$1 and status='PENDING' order by created_at desc for update", [this.userId]);
    if (pending.length > 1) return "Conflicting pending changes. Cancel them before confirming.";
    const current = pending[0];
    if (!current) {
      const prior = (await this.rows("select * from pending_confirmations where user_id=$1 order by created_at desc limit 1", [this.userId]))[0];
      return prior?.status === "APPLIED" && /^(yes|confirm)$/i.test(input.trim()) ? prior.result_body : "No pending confirmation.";
    }
    if (current.expires_at <= new Date()) { await this.db.query("update pending_confirmations set status='EXPIRED' where id=$1", [current.id]); return "Confirmation expired. Request the change again."; }
    if (/^(no|cancel)$/i.test(input.trim())) { await this.db.query("update pending_confirmations set status='REJECTED',rejected_at=now() where id=$1", [current.id]); return "Change cancelled."; }
    const plan = current.proposed_action as Plan;
    if (!(await this.validVersions(plan))) { await this.db.query("update pending_confirmations set status='STALE' where id=$1", [current.id]); return "The target changed. Request the change again."; }
    await this.db.query("savepoint confirmation_application");
    let body: string;
    try { body = await this.execute(plan, `confirmation:${current.id}`, current.id); }
    catch (error) {
      await this.db.query("rollback to savepoint confirmation_application");
      if (error instanceof Error && "code" in error) throw error;
      await this.db.query("update pending_confirmations set status='STALE' where id=$1", [current.id]);
      return "The target or alias changed. Request the change again.";
    }
    await this.db.query("release savepoint confirmation_application");
    const command = (await this.rows("select id from command_executions where user_id=$1 and idempotency_key=$2", [this.userId, `confirmation:${current.id}`]))[0]!;
    await this.db.query("update pending_confirmations set status='APPLIED',confirmed_at=now(),applied_command_id=$2,result_body=$3 where id=$1", [current.id, command.id, body]);
    return body;
  }
  private async validVersions(plan: Plan): Promise<boolean> {
    for (const [key, version] of Object.entries(plan.versions)) {
      const split = key.indexOf(":"), table = key.slice(0, split), id = key.slice(split + 1);
      if (!["workout_sessions", "routines", "exercise_identities", "routine_sequence_cursors"].includes(table)) return false;
      const owner = table === "exercise_identities" ? "(owner_user_id=$2 or owner_user_id is null)" : "user_id=$2";
      const row = (await this.rows(`select version from ${table} where id=$1 and ${owner} for update`, [id, this.userId]))[0];
      if (!row || row.version !== version) return false;
    }
    return true;
  }
  private async command(key: string, kind: string): Promise<string> {
    const result = await this.rows("insert into command_executions(id,user_id,command_type,idempotency_key,status) values($1,$2,$3,$4,'APPLIED') returning id", [randomUUID(), this.userId, kind, key]);
    return result[0]!.id;
  }
  private async audit(commandId: string, confirmationId: string | undefined, type: string, targetType: string, targetId: string, before: unknown, after: unknown, workoutId?: string): Promise<void> {
    await this.db.query(`insert into corrections(id,user_id,workout_session_id,type,target_type,target_id,before_snapshot,after_snapshot,source_surface,source_message_id,confirmation_id,command_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [randomUUID(), this.userId, workoutId ?? null, type, targetType, targetId, JSON.stringify(before), JSON.stringify(after), this.surface, this.messageId, confirmationId ?? null, commandId]);
  }
  private async ensureIdentity(value: { id?: string; name?: string }): Promise<string> {
    if (value.id) {
      if (!(await this.rows("select id from exercise_identities where id=$1 and (owner_user_id=$2 or owner_user_id is null) and merged_into_id is null", [value.id, this.userId]))[0]) throw new Error("Exercise identity changed. Request the change again.");
      return value.id;
    }
    const ref = await this.identity(value.name!);
    if ("id" in ref) return ref.id;
    if ("question" in ref) throw new Error(ref.question);
    const id = randomUUID();
    await this.db.query("insert into exercise_identities(id,owner_user_id,display_name,default_load_semantics) values($1,$2,$3,'UNSPECIFIED_DEFAULT')", [id, this.userId, value.name]);
    return id;
  }
  private async addAlias(identityId: string, alias: string): Promise<void> {
    const resolution = await this.identity(alias);
    if ("question" in resolution || ("id" in resolution && resolution.id !== identityId)) throw new Error("Alias conflict. Choose a different alias.");
    await this.db.query("insert into exercise_aliases(id,user_id,exercise_identity_id,alias_text,normalized_alias,status) values($1,$2,$3,$4,$5,'CONFIRMED') on conflict do nothing", [randomUUID(), this.userId, identityId, alias, normalizeExerciseName(alias)]);
  }
  private async execute(plan: Plan, key: string, confirmationId?: string): Promise<string> {
    await this.authorize();
    const existing = (await this.rows("select result_summary from command_executions where user_id=$1 and idempotency_key=$2 and status='COMPLETED'", [this.userId, key]))[0];
    if (existing) return existing.result_summary.body;
    if (!(await this.validVersions(plan))) throw new Error("The target changed. Request the change again.");
    if (plan.confirm && !confirmationId && this.surface !== "WEB") throw new Error("Confirmation required");
    const commandId = await this.command(key, plan.kind), a = plan.args;
    if (plan.kind === "REPLACE_WORKOUT") {
      const before = (await this.rows("select * from workout_sessions where id=$1 and user_id=$2", [a.workoutId, this.userId]))[0];
      await new WorkoutSelection(this.db, this.userId).replace(a.workoutId, a.templateId);
      await this.audit(commandId, confirmationId, plan.kind, "WORKOUT_SESSION", a.workoutId, before, { status: "CANCELLED_REPLACED", replacementTemplateId: a.templateId }, a.workoutId);
    } else if (plan.kind === "REORDER_SESSION") {
      const before = await this.rows("select id,sequence_index from workout_session_templates where routine_id=$1 and archived_at is null order by sequence_index", [a.routineId]);
      const ids = reorderedIds(before.map(row => row.id), a.templateId, a.ordinal);
      await this.db.query("update workout_session_templates set sequence_index=sequence_index+100000 where routine_id=$1", [a.routineId]);
      for (const [index, id] of ids.entries()) await this.db.query("update workout_session_templates set sequence_index=$2 where id=$1 and routine_id=$3", [id, index, a.routineId]);
      await this.db.query("update routine_sequence_cursors c set cursor_sequence_index=t.sequence_index from workout_session_templates t where c.next_session_template_id=t.id and c.routine_id=$1 and c.user_id=$2", [a.routineId, this.userId]);
      await this.audit(commandId, confirmationId, plan.kind, "ROUTINE", a.routineId, before, ids);
    } else if (plan.kind === "CORRECT_SET" || plan.kind === "DELETE_SET") {
      const target = (await this.rows("select * from workout_sets where id=$1 and user_id=$2 and status='RECORDED' for update", [a.targetId, this.userId]))[0];
      if (!target) throw new Error("Set unavailable");
      if (plan.kind === "CORRECT_SET") await this.db.query("update workout_sets set load_value=$2,weight_unit=$3,load_semantics=$4,reps=$5 where id=$1 and user_id=$6", [a.targetId, a.after.loadValue, a.after.weightUnit, a.after.loadSemantics, a.after.reps, this.userId]);
      else await this.db.query("update workout_sets set status='DELETED' where id=$1 and user_id=$2", [a.targetId, this.userId]);
      await this.audit(commandId, confirmationId, plan.kind, "WORKOUT_SET", a.targetId, a.before, a.after, a.workoutId);
    } else if (plan.kind === "DELETE_GROUP") {
      for (const target of await this.rows("select * from workout_sets where id=any($1::text[]) and user_id=$2 and status='RECORDED' for update", [a.ids, this.userId])) {
        await this.db.query("update workout_sets set status='DELETED' where id=$1 and user_id=$2", [target.id, this.userId]);
        await this.audit(commandId, confirmationId, "DELETE_SET", "WORKOUT_SET", target.id, target, { ...target, status: "DELETED" }, target.workout_session_id);
      }
      if (a.groupKind === "WORKOUT" || a.groupKind === "HISTORY") await this.db.query("update workout_sessions set status='DISCARDED',discarded_at=now(),active_session_exercise_id=null where id=any($1::text[]) and user_id=$2", [a.workoutIds, this.userId]);
      else {
        const exercises = await this.rows("select distinct session_exercise_id from workout_sets where id=any($1::text[]) and user_id=$2", [a.ids, this.userId]);
        const ids = exercises.map(row => row.session_exercise_id);
        await this.db.query("update session_exercises set status='DELETED' where id=any($1::text[])", [ids]);
        await this.db.query("update workout_sessions set active_session_exercise_id=null where user_id=$1 and active_session_exercise_id=any($2::text[])", [this.userId, ids]);
      }
    } else if (plan.kind === "CREATE_CUSTOM_EXERCISE") {
      const identityId = await this.ensureIdentity(a.identity);
      for (const alias of a.aliases) await this.addAlias(identityId, alias);
      await this.audit(commandId, confirmationId, plan.kind, "EXERCISE_IDENTITY", identityId, {}, { name: a.identity.name, aliases: a.aliases });
    } else if (plan.kind === "MAP_EXERCISE_ALIAS") {
      await this.addAlias(a.identityId, a.alias);
      await this.audit(commandId, confirmationId, plan.kind, "EXERCISE_IDENTITY", a.identityId, {}, { alias: a.alias });
    } else if (plan.kind === "MERGE_IDENTITIES") {
      const owned = await this.rows("select * from exercise_identities where id=any($1::text[]) and owner_user_id=$2 and merged_into_id is null for update", [[a.fromId, a.toId], this.userId]);
      if (owned.length !== 2) throw new Error("Merge target changed");
      await this.db.query("update workout_sets set exercise_identity_id=$2 where exercise_identity_id=$1 and user_id=$3", [a.fromId, a.toId, this.userId]);
      await this.db.query("update session_exercises se set exercise_identity_id=$2 from workout_sessions w where se.workout_session_id=w.id and w.user_id=$3 and se.exercise_identity_id=$1", [a.fromId, a.toId, this.userId]);
      await this.db.query("update planned_exercises p set exercise_identity_id=$2 from workout_session_templates t,routines r where p.session_template_id=t.id and t.routine_id=r.id and r.user_id=$3 and p.exercise_identity_id=$1", [a.fromId, a.toId, this.userId]);
      await this.db.query("update exercise_aliases set exercise_identity_id=$2 where exercise_identity_id=$1 and user_id=$3", [a.fromId, a.toId, this.userId]);
      await this.db.query("update exercise_identities set merged_into_id=$2,version=version+1 where id=$1 and owner_user_id=$3", [a.fromId, a.toId, this.userId]);
      await this.audit(commandId, confirmationId, plan.kind, "EXERCISE_IDENTITY", a.fromId, owned, { mergedInto: a.toId });
    } else if (plan.kind === "PERMANENT_EXERCISE") {
      const before = await this.rows("select * from planned_exercises where session_template_id=$1 order by order_index", [a.templateId]);
      const identityId = a.identity ? await this.ensureIdentity(a.identity) : undefined;
      if (a.operation === "REPLACE_EXERCISE") await this.db.query("update planned_exercises set exercise_identity_id=$2 where id=$1 and session_template_id=$3", [a.plannedId, identityId, a.templateId]);
      else if (a.operation === "REMOVE_EXERCISE" || a.operation === "SKIP_EXERCISE") {
        // Existing workout snapshots keep their source reference; removal is a future-template flag.
        await this.db.query("update planned_exercises set removed_at=now() where id=$1 and session_template_id=$2", [a.plannedId, a.templateId]);
      } else if (a.operation === "ADD_EXERCISE") await this.db.query("insert into planned_exercises(id,session_template_id,exercise_identity_id,order_index,planned_set_count,rep_target_min,rep_target_max) values($1,$2,$3,$4,null,null,null)", [randomUUID(), a.templateId, identityId, before.length ? Math.max(...before.map(row => row.order_index)) + 1 : 0]);
      else if (a.operation === "REORDER_EXERCISE") {
        const ids = reorderedIds(before.filter(row => !row.removed_at).map(row => row.id), a.plannedId, a.ordinal);
        await this.db.query("update planned_exercises set order_index=order_index+100000 where session_template_id=$1", [a.templateId]);
        for (const [index, id] of ids.entries()) await this.db.query("update planned_exercises set order_index=$2 where id=$1", [id, index]);
      } else throw new Error("Unsupported routine operation");
      await this.audit(commandId, confirmationId, plan.kind, "ROUTINE", a.routineId, before, await this.rows("select * from planned_exercises where session_template_id=$1 order by order_index", [a.templateId]));
    } else if (plan.kind === "LOG_CONTEXT_SETS") {
      const identityId = await this.ensureIdentity(a.identity);
      let exercises = await this.rows("select id from session_exercises where workout_session_id=$1 and exercise_identity_id=$2 and status not in ('REPLACED','DELETED')", [a.workoutId, identityId]);
      if (exercises.length > 1) throw new Error("Choose the exact session exercise before logging.");
      let sessionExerciseId = exercises[0]?.id;
      if (!sessionExerciseId) {
        sessionExerciseId = randomUUID();
        await this.db.query("insert into session_exercises(id,workout_session_id,exercise_identity_id,order_index,status,planned_set_count_snapshot,rep_target_min_snapshot,rep_target_max_snapshot) select $1,$2,$3,coalesce(max(order_index),-1)+1,'IN_PROGRESS',null,null,null from session_exercises where workout_session_id=$2", [sessionExerciseId, a.workoutId, identityId]);
      }
      await this.db.query("update workout_sessions set active_session_exercise_id=$2 where id=$1 and user_id=$3", [a.workoutId, sessionExerciseId, this.userId]);
      await this.db.query("update session_exercises set status='IN_PROGRESS' where id=$1", [sessionExerciseId]);
      let index = Number((await this.rows("select coalesce(max(set_index),0) as n from workout_sets where session_exercise_id=$1", [sessionExerciseId]))[0]!.n);
      for (const set of a.sets) {
        index++;
        await this.db.query("insert into workout_sets(id,user_id,workout_session_id,session_exercise_id,exercise_identity_id,set_index,load_value,weight_unit,load_semantics,reps,status,idempotency_key,source_message_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'RECORDED',$11,$12)", [randomUUID(), this.userId, a.workoutId, sessionExerciseId, identityId, index, set.loadValue, set.weightUnit, set.loadSemantics, set.reps, `${key}:${index}`, this.messageId]);
      }
      if (confirmationId) await this.audit(commandId, confirmationId, "CREATE_CUSTOM_EXERCISE", "EXERCISE_IDENTITY", identityId, {}, a.identity, a.workoutId);
    } else {
      const before = await this.rows("select * from session_exercises where workout_session_id=$1 order by order_index", [a.workoutId]);
      if (plan.kind === "SKIP_SET") await this.db.query("update session_exercises set skipped_set_count=skipped_set_count+1 where id=$1 and workout_session_id=$2 and skipped_set_count<planned_set_count_snapshot", [a.exerciseId, a.workoutId]);
      else if (plan.kind === "CHANGE_ACTIVE_EXERCISE" || plan.kind === "REORDER_EXERCISE") {
        if (plan.kind === "REORDER_EXERCISE") {
          const ids = reorderedIds(before.map(row => row.id), a.exerciseId, a.ordinal);
          for (const [index, id] of ids.entries()) await this.db.query("update session_exercises set order_index=$2 where id=$1", [id, index]);
        }
        await this.db.query("update session_exercises set status='IN_PROGRESS' where id=$1 and workout_session_id=$2", [a.exerciseId, a.workoutId]);
        await this.db.query("update workout_sessions set active_session_exercise_id=$2 where id=$1 and user_id=$3", [a.workoutId, a.exerciseId, this.userId]);
      } else if (plan.kind === "SKIP_EXERCISE") {
        await this.db.query("update session_exercises set status='SKIPPED' where id=$1 and workout_session_id=$2", [a.sourceId, a.workoutId]);
        await this.db.query("update workout_sessions set active_session_exercise_id=null where id=$1 and user_id=$2 and active_session_exercise_id=$3", [a.workoutId, this.userId, a.sourceId]);
      } else if (plan.kind === "REPLACE_EXERCISE" || plan.kind === "ADD_EXERCISE") {
        const identityId = await this.ensureIdentity(a.identity), newId = randomUUID();
        const source = before.find(row => row.id === a.sourceId);
        if (source) await this.db.query("update session_exercises set status='REPLACED',order_index=$2 where id=$1", [source.id, before.length + 10000]);
        await this.db.query("insert into session_exercises(id,workout_session_id,exercise_identity_id,order_index,status,planned_set_count_snapshot,rep_target_min_snapshot,rep_target_max_snapshot) values($1,$2,$3,$4,'IN_PROGRESS',$5,$6,$7)", [newId, a.workoutId, identityId, source?.order_index ?? before.length, source?.planned_set_count_snapshot ?? null, source?.rep_target_min_snapshot ?? null, source?.rep_target_max_snapshot ?? null]);
        await this.db.query("update workout_sessions set active_session_exercise_id=$2 where id=$1 and user_id=$3", [a.workoutId, newId, this.userId]);
      } else throw new Error("Unsupported action");
      await this.audit(commandId, confirmationId, plan.kind, "WORKOUT_SESSION", a.workoutId, before, await this.rows("select * from session_exercises where workout_session_id=$1 order by order_index", [a.workoutId]), a.workoutId);
    }
    if (a.workoutId) await this.db.query("update session_exercises se set exercise_name_snapshot=e.display_name from exercise_identities e where se.exercise_identity_id=e.id and se.workout_session_id=$1 and se.exercise_name_snapshot is null", [a.workoutId]);
    for (const key of Object.keys(plan.versions)) {
      const split = key.indexOf(":"), table = key.slice(0, split);
      await this.db.query(`update ${table} set version=version+1 where id=$1`, [key.slice(split + 1)]);
    }
    const body = `${plan.summary} applied.`;
    await this.db.query("update command_executions set status='COMPLETED',result_summary=$2,applied_at=now() where id=$1", [commandId, JSON.stringify({ body })]);
    return body;
  }
}
