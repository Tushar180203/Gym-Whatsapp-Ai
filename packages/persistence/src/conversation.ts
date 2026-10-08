import type { PoolClient } from "pg";
import type { IntentInterpreter } from "../../ai/src/interfaces.js";
import { ConversationStateSchema, emptyConversation, type ConversationContext, type ConversationState } from "../../domain/src/conversation/state.js";
import type { ConversationPorts, ConversationTrace } from "../../domain/src/conversation/orchestrator.js";
import type { Us4Action, ReplaceWorkoutAction } from "../../domain/src/parser/us4-parser.js";
import { parseCompletionIntent } from "../../domain/src/workouts/completion-policy.js";
import { hasSetNotation } from "../../domain/src/parser/set-parser.js";
import { Us4Commands } from "./us4.js";
import { WorkoutSelection } from "./workout-selection.js";
import { WorkoutLifecycle } from "./workout-lifecycle.js";
import { AnalyticsQueries } from "./analytics-queries.js";
import { answerHistoryQuestion } from "../../analytics/src/history-question-service.js";
import { DomainError } from "./store.js";
import { formatSetFact } from "../../domain/src/conversation/responses.js";

export class PostgresConversation implements ConversationPorts {
  readonly interpreter?: IntentInterpreter;
  readonly beforeAi?: () => void;
  readonly observe?: (trace: ConversationTrace) => void;
  private readonly commands: Us4Commands;
  private readonly selection: WorkoutSelection;
  private readonly lifecycle: WorkoutLifecycle;
  constructor(private readonly db: PoolClient, readonly userId: string, readonly key: string,
    private readonly deterministicHandler: (text: string) => Promise<string | undefined>,
    private readonly logHandler: (notation: string) => Promise<void>,
    options: { interpreter?: IntentInterpreter; beforeAi?: () => void; observe?: (trace: ConversationTrace) => void } = {}) {
    if (options.interpreter) this.interpreter = options.interpreter;
    if (options.beforeAi) this.beforeAi = options.beforeAi;
    if (options.observe) this.observe = options.observe;
    this.commands = new Us4Commands(db, userId, key);
    this.selection = new WorkoutSelection(db, userId); this.lifecycle = new WorkoutLifecycle(db, userId);
  }
  now() { return Date.now(); }
  async load() {
    const row = (await this.db.query("select state from conversation_states where user_id=$1 for update", [this.userId])).rows[0];
    return { state: row ? ConversationStateSchema.parse(row.state) : emptyConversation(), context: await this.refresh() };
  }
  async refresh(): Promise<ConversationContext> {
    const workoutRow = (await this.db.query("select id,name,status,version,active_session_exercise_id,completion_choice_pending,session_template_id from workout_sessions where user_id=$1 and data_deleted_at is null and status in ('PROPOSED','ACTIVE','PAUSED')", [this.userId])).rows[0];
    const identities = (await this.db.query(`select e.id,e.display_name as name,coalesce(array_agg(a.alias_text) filter(where a.id is not null),'{}') as aliases
      from exercise_identities e left join exercise_aliases a on a.exercise_identity_id=e.id and a.user_id=$1 and a.status='CONFIRMED'
      where (e.owner_user_id=$1 or e.owner_user_id is null) and e.merged_into_id is null group by e.id order by e.id limit 100`, [this.userId])).rows;
    const exercises = workoutRow ? (await this.db.query(`select se.id,se.exercise_identity_id as "identityId",coalesce(se.exercise_name_snapshot,e.display_name) as name,se.order_index as "order",se.status,
      se.planned_set_count_snapshot as "plannedSets",se.rep_target_min_snapshot as "repsMin",se.rep_target_max_snapshot as "repsMax",coalesce(recorded.n,0) as "recordedSets",
      coalesce((select array_agg(a.alias_text) from exercise_aliases a where a.user_id=$2 and a.exercise_identity_id=se.exercise_identity_id and a.status='CONFIRMED'),'{}') as aliases
      from session_exercises se join exercise_identities e on e.id=se.exercise_identity_id left join (
        select session_exercise_id,count(*)::int as n from workout_sets where workout_session_id=$1 and user_id=$2 and status='RECORDED' group by session_exercise_id
      ) recorded on recorded.session_exercise_id=se.id where se.workout_session_id=$1 and se.status not in ('REPLACED','DELETED') order by se.order_index`, [workoutRow.id, this.userId])).rows : [];
    const sets = workoutRow ? (await this.db.query(`select * from (select id,session_exercise_id as "exerciseId",set_index as index,load_value::float8 as load,weight_unit as unit,load_semantics as semantics,reps,created_at
      from workout_sets where workout_session_id=$1 and user_id=$2 and status='RECORDED' order by created_at desc,set_index desc,id desc limit 500) recent order by created_at,index,id`, [workoutRow.id, this.userId])).rows : [];
    const confirmation = (await this.db.query("select id,action_type as \"actionType\" from pending_confirmations where user_id=$1 and status='PENDING' order by created_at desc limit 1", [this.userId])).rows[0] ?? null;
    const choices = workoutRow ? [] : (await this.db.query(`select t.id,r.name || ': ' || t.name as name from routines r join routine_sequence_cursors c on c.routine_id=r.id and c.user_id=r.user_id
      join workout_session_templates t on t.id=c.next_session_template_id where r.user_id=$1 and r.archived_at is null and t.archived_at is null order by r.created_at limit 50`, [this.userId])).rows;
    return { workout: workoutRow ? { id: workoutRow.id, name: workoutRow.name, status: workoutRow.status, version: workoutRow.version, activeExerciseId: workoutRow.active_session_exercise_id, finishPending: Boolean(workoutRow.completion_choice_pending), ...(workoutRow.session_template_id ? { templateId: workoutRow.session_template_id } : {}) } : null,
      identities: identities.map(i => ({ id: i.id, name: i.name, aliases: i.aliases })),
      exercises: exercises.map(e => ({ ...e, aliases: e.aliases ?? identities.find(i => i.id === e.identityId)?.aliases ?? [] })), sets, confirmation, choices };
  }
  async save(state: ConversationState) {
    const value = ConversationStateSchema.parse(state);
    const result = await this.db.query(`insert into conversation_states(user_id,version,state) values($1,$2,$3)
      on conflict(user_id) do update set version=excluded.version,state=excluded.state,updated_at=clock_timestamp()
      where conversation_states.version=$2-1 returning user_id`, [this.userId, value.version, JSON.stringify(value)]);
    if (result.rowCount === 0) throw new DomainError("Conversation changed", "STALE_VERSION");
  }
  async cancel() {
    await this.db.query("update pending_confirmations set status='REJECTED',rejected_at=clock_timestamp() where user_id=$1 and status='PENDING'", [this.userId]);
    await this.db.query("update inbound_messages set clarification_resolved_at=clock_timestamp() where user_id=$1 and clarification_action is not null and clarification_resolved_at is null", [this.userId]);
  }
  async confirm(text: string) {
    const before = (await this.refresh()).confirmation;
    let body = await this.commands.resolveConfirmation(text) ?? "No pending confirmation.";
    const applied = before && (await this.db.query("select id from pending_confirmations where id=$1 and user_id=$2 and status='APPLIED'", [before.id, this.userId])).rows.length > 0;
    if (applied && /^(Changed active exercise|Change today only|Log sets for confirmed exercise|Create custom exercise).*applied\.$/.test(body)) {
      const context = await this.lifecycle.context(); if (context) body += `\n${context}`;
    }
    return { body, applied: Boolean(applied) };
  }
  deterministic(text: string) { return this.deterministicHandler(text); }
  async resolveIdentity(reference: string) {
    return (await this.db.query(`select distinct e.id,e.display_name as name,'{}'::text[] as aliases from exercise_identities e
      left join exercise_aliases a on a.exercise_identity_id=e.id and a.user_id=$1 and a.status='CONFIRMED'
      where (e.owner_user_id=$1 or e.owner_user_id is null) and e.merged_into_id is null and
      (e.id=$2 or lower(e.display_name)=lower($2) or lower(a.alias_text)=lower($2)) order by e.id limit 2`, [this.userId, reference])).rows;
  }
  async workoutChoices() {
    return (await this.db.query(`select t.id,r.name || ': ' || t.name as name from workout_session_templates t join routines r on r.id=t.routine_id
      where r.user_id=$1 and r.archived_at is null and t.archived_at is null order by r.created_at,t.sequence_index limit 50`, [this.userId])).rows;
  }
  async log(notation: string, next = false) {
    const context = await this.refresh();
    if (next) {
      const index = context.exercises.findIndex(e => e.id === context.workout?.activeExerciseId);
      if (index < 0 || !context.exercises.slice(index + 1).some(e => e.status !== "SKIPPED")) return "No next planned exercise. Log the set separately or choose an exercise first.";
    }
    await this.db.query("savepoint conversation_log");
    try {
      await this.logHandler(notation);
      const recorded = (await this.db.query(`select id,session_exercise_id as "exerciseId",set_index as index,load_value::float8 as load,weight_unit as unit,load_semantics as semantics,reps
        from workout_sets where user_id=$1 and source_message_id=$2 and status='RECORDED' order by set_index`, [this.userId, this.key])).rows;
      let body = recorded.length ? `Logged: ${recorded.map(formatSetFact).join(", ")}` : "Logged set";
      if (next) body += `\n${await this.commands.dispatch({ type: "NEXT_EXERCISE" }, "next", `${this.key}:compound-next`)}`;
      await this.db.query("release savepoint conversation_log"); return body;
    } catch (error) {
      await this.db.query("rollback to savepoint conversation_log"); await this.db.query("release savepoint conversation_log");
      if (error instanceof DomainError && error.code === "AMBIGUOUS_SAME") return "I can't resolve same here. Send the load and reps, such as 45x10.";
      if (error instanceof DomainError && error.code === "NO_ACTIVE_WORKOUT") return context.workout?.status === "PROPOSED" ? "Reply START to begin your proposed workout before logging sets." : "Send START to choose and begin a workout before logging sets.";
      if (error instanceof DomainError && error.code === "EXERCISE_REQUIRED") return "Choose an exercise in this workout before logging sets.";
      if (error instanceof DomainError && error.code === "PREFERRED_UNIT_REQUIRED") return "Set your preferred weight unit on the website before logging sets.";
      if (error instanceof DomainError && ["INVALID_SET_VALUES", "MISSING_NUMERIC_VALUES", "NO_SET_NOTATION"].includes(error.code)) return "Send a nonnegative load and positive completed reps, such as 45x10.";
      throw error;
    }
  }
  async execute(action: Us4Action | ReplaceWorkoutAction, input: string, step = "us4") {
    if (action.type === "START_WORKOUT") return this.selection.start(action.routineRef, action.sessionRef);
    if (action.type === "CHANGE_SESSION") return action.scope === "SESSION_ONLY" ? this.selection.choose(action.sessionRef) : "Choose another workout today, or explicitly request a confirmed routine change.";
    if (action.type === "RESUME_WORKOUT") return this.lifecycle.resume(action.workoutRef);
    if (action.type === "FINISH_WORKOUT") return this.lifecycle.finish(`${this.key}:finish`, parseCompletionIntent(input) ?? "REQUEST");
    if (action.type === "QUERY_HISTORY" || action.type === "QUERY_ANALYTICS") return answerHistoryQuestion(await new AnalyticsQueries(this.db, this.userId).snapshot(), action);
    if (action.type === "LOG_SET" || action.type === "LOG_MULTIPLE_SETS") {
      const sets = action.type === "LOG_SET" ? [action.set] : action.sets;
      const supplied = (input.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
      if (sets.some(set => set.loadValue === undefined || !supplied.includes(set.loadValue) || !supplied.includes(set.reps)
        || (set.weightUnit && !new RegExp(`\\b${set.weightUnit}\\b`, "i").test(input))
        || (set.loadSemantics && !/each|per.hand|per.side|total|stack|default/i.test(input)))) return "Send the load and reps explicitly before I record a set.";
      if (sets.some(set => set.loadSemantics && set.loadSemantics !== "PER_HAND_PER_SIDE")) return "Use the exercise's confirmed load convention, or specify the convention in your exercise settings.";
      const text = sets.map(set => `${set.loadValue} ${set.weightUnit ?? ""} ${set.loadSemantics === "PER_HAND_PER_SIDE" ? "each " : "x "}${set.reps}`).join(", ");
      const refs = new Set(sets.map(set => set.exerciseRef ?? "current"));
      if (refs.size !== 1) return "Log one exercise at a time so I can resolve the target safely.";
      const ref = sets[0]?.exerciseRef;
      if (ref) return this.commands.dispatch({ type: "LOG_CONTEXT_SETS", exerciseRef: ref, setText: text }, input, `${this.key}:us4`);
      return this.log(text);
    }
    const body = await this.commands.dispatch(action, input, `${this.key}:${step}`);
    const context = /^(Changed active exercise|Change today only|Log sets for confirmed exercise|Create custom exercise).*applied\.$/.test(body) ? await this.lifecycle.context() : "";
    return context ? `${body}\n${context}` : body;
  }
  async plan() {
    const active = await this.selection.active();
    if (active) {
      const context = await this.refresh();
      return `${active.status === "PROPOSED" ? "Proposed" : "Active"} ${active.name}\n${context.exercises.map((e, i) => `${i + 1}. ${e.name}: ${e.plannedSets ?? "unplanned"} sets, ${e.repsMin ?? "unspecified"}${e.repsMax !== e.repsMin ? `-${e.repsMax}` : ""} reps`).join("\n")}\n${active.status === "PROPOSED" ? "Reply START to begin." : "Log a set, NEXT, or DONE."}`;
    }
    const result = await this.selection.target();
    if ("clarification" in result) return result.clarification;
    const planned = (await this.db.query(`select e.display_name,p.planned_set_count,p.rep_target_min,p.rep_target_max from planned_exercises p join exercise_identities e on e.id=p.exercise_identity_id where p.session_template_id=$1 and p.removed_at is null order by p.order_index`, [result.template.id])).rows;
    return `${result.template.name} is next\n${planned.map((e, i) => `${i + 1}. ${e.display_name}: ${e.planned_set_count} sets, ${e.rep_target_min}-${e.rep_target_max} reps`).join("\n")}\nReply START to request the workout.`;
  }
}
