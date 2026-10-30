import { numericEvidence, hasExplicitUnit, hasSetCountEvidence, hasPerHandEvidence } from "../../domain/src/conversation/numeric-evidence.js";
import { resolveExerciseReference } from "../../domain/src/conversation/references.js";
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
import { ConversationMemory } from "./conversation-memory.js";
import { type DomainOutcome, type ResponseCategory, formatSetFact } from "../../domain/src/conversation/responses.js";

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
  private latestOutcome: DomainOutcome | undefined;
  outcome() { return this.latestOutcome; }
  private async result(category: ResponseCategory, operation: () => Promise<string | undefined>) {
    const before = await this.refresh();
    const body = await operation();
    const after = await this.refresh();
    const changed = before.workout?.id !== after.workout?.id || before.workout?.version !== after.workout?.version || before.sets.length !== after.sets.length;
    const readOnly = ["HISTORY_FACT", "ANALYTICS_FACT", "COACHING_BOUNDARY"].includes(category);
    const protectedChange = Boolean(after.confirmation) && !readOnly;
    this.latestOutcome = { category: protectedChange ? "CONFIRMATION_REQUIRED" : after.workout?.finishPending && category === "WORKOUT_FINISHED" ? "PENDING_QUESTION" : changed ? category : category === "WORKOUT_RESUMED" ? "CURRENT_STATE" : ["HISTORY_FACT", "ANALYTICS_FACT", "COACHING_BOUNDARY"].includes(category) ? category : "RECOVERY", effect: protectedChange ? "CONFIRMATION_REQUIRED" : after.workout?.finishPending && category === "WORKOUT_FINISHED" ? "CLARIFIED" : changed ? "APPLIED" : ["HISTORY_FACT", "ANALYTICS_FACT", "COACHING_BOUNDARY"].includes(category) ? "READ_ONLY" : "REPLIED" };
    return body;
  }
  now() { return Date.now(); }
  async load() {
    const row = (await this.db.query("select state from conversation_states where user_id=$1 for update", [this.userId])).rows[0];
    return { state: row ? ConversationStateSchema.parse(row.state) : emptyConversation(), context: { ...await this.refresh(), recentConversation: await new ConversationMemory(this.db, this.userId).recent() } };
  }
  async refresh(): Promise<ConversationContext> {
    const profile = (await this.db.query("select preferred_weight_unit,time_zone from user_profiles where user_id=$1", [this.userId])).rows[0];
    const workoutRow = (await this.db.query("select id,name,status,version,active_session_exercise_id,completion_choice_pending,session_template_id from workout_sessions where user_id=$1 and data_deleted_at is null and status in ('PROPOSED','ACTIVE','PAUSED')", [this.userId])).rows[0];
    const identities = (await this.db.query(`select e.id,e.display_name as name,coalesce(array_agg(a.alias_text) filter(where a.id is not null),'{}') as aliases
      from exercise_identities e left join exercise_aliases a on a.exercise_identity_id=e.id and a.user_id=$1 and a.status='CONFIRMED'
      where (e.owner_user_id=$1 or e.owner_user_id is null) and e.merged_into_id is null group by e.id order by e.id limit 100`, [this.userId])).rows;
    const exercises = workoutRow ? (await this.db.query(`select se.id,se.exercise_identity_id as "identityId",coalesce(se.exercise_name_snapshot,e.display_name) as name,se.order_index as "order",se.status,e.default_load_semantics as "loadSemantics",
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
    return { timeZone: profile?.time_zone ?? "UTC", ...(profile?.preferred_weight_unit ? { preferredWeightUnit: profile.preferred_weight_unit } : {}), workout: workoutRow ? { id: workoutRow.id, name: workoutRow.name, status: workoutRow.status, version: workoutRow.version, activeExerciseId: workoutRow.active_session_exercise_id, finishPending: Boolean(workoutRow.completion_choice_pending), ...(workoutRow.session_template_id ? { templateId: workoutRow.session_template_id } : {}) } : null,
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
    this.latestOutcome = { category: applied ? before?.actionType === "CORRECT_SET" ? "SET_CORRECTED" : "EXERCISE_CHANGED" : "RECOVERY", effect: applied ? "APPLIED" : "REPLIED" };
    return { body, applied: Boolean(applied) };
  }
  async deterministic(text: string) {
    const before = await this.refresh();
    const category: ResponseCategory = /^(start|start planned)$/i.test(text) ? before.workout?.status === "PROPOSED" ? "WORKOUT_STARTED" : "WORKOUT_PROPOSAL" : /^(resume|continue)$/i.test(text) ? "WORKOUT_RESUMED" : parseCompletionIntent(text) ? "WORKOUT_FINISHED" : "DOMAIN_RESULT";
    return this.result(category, () => this.deterministicHandler(text));
  }
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
  async log(notation: string, next = false): Promise<string> {
    return (await this.result(notation.includes(",") ? "SETS_LOGGED" : "SET_LOGGED", () => this.logResult(notation, next)))!;
  }
  private async logResult(notation: string, next = false) {
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
      let body = recorded.length ? `Logged: ${recorded.map(formatSetFact).join(", ")}` : "No new set was recorded. Send the load and completed reps again.";
      if (next) body += `\n${await this.commands.dispatch({ type: "NEXT_EXERCISE" }, "next", `${this.key}:compound-next`)}`;
      await this.db.query("release savepoint conversation_log"); return body;
    } catch (error) {
      await this.db.query("rollback to savepoint conversation_log"); await this.db.query("release savepoint conversation_log");
      if (error instanceof DomainError && error.code === "AMBIGUOUS_SAME") return "I can't resolve same here. Send the load and reps, such as 45x10.";
      if (error instanceof DomainError && error.code === "NO_ACTIVE_WORKOUT") return context.workout?.status === "PAUSED" ? "Your workout is paused. Send RESUME before logging sets." : context.workout?.status === "PROPOSED" ? "Reply START to begin your proposed workout before logging sets." : "Send START to choose and begin a workout before logging sets.";
      if (error instanceof DomainError && error.code === "EXERCISE_REQUIRED") return "Choose an exercise in this workout before logging sets.";
      if (error instanceof DomainError && error.code === "PREFERRED_UNIT_REQUIRED") return "Set your preferred weight unit on the website before logging sets.";
      if (error instanceof DomainError && ["INVALID_SET_VALUES", "MISSING_NUMERIC_VALUES", "NO_SET_NOTATION"].includes(error.code)) return "Send a nonnegative load and positive completed reps, such as 45x10.";
      throw error;
    }
  }
  async execute(action: Us4Action | ReplaceWorkoutAction, input: string, step = "us4"): Promise<string> {
    const category: ResponseCategory = ["QUERY_HISTORY", "QUERY_CONVERSATION"].includes(action.type) ? "HISTORY_FACT" : action.type === "QUERY_ANALYTICS" ? "ANALYTICS_FACT" : action.type === "CORRECT_SET" ? "SET_CORRECTED" : action.type === "LOG_SET" ? "SET_LOGGED" : action.type === "LOG_MULTIPLE_SETS" ? "SETS_LOGGED" : action.type === "START_WORKOUT" ? "WORKOUT_PROPOSAL" : action.type === "RESUME_WORKOUT" ? "WORKOUT_RESUMED" : action.type === "FINISH_WORKOUT" ? "WORKOUT_FINISHED" : "EXERCISE_CHANGED";
    return (await this.result(category, () => this.executeResult(action, input, step)))!;
  }
  private async executeResult(action: Us4Action | ReplaceWorkoutAction, input: string, step = "us4") {
    if (action.type === "QUERY_CONVERSATION") {
      const context = await this.refresh();
      return new ConversationMemory(this.db, this.userId).recall(context.timeZone ?? "UTC", action);
    }
    if (action.type === "START_WORKOUT") return this.selection.start(action.routineRef, action.sessionRef);
    if (action.type === "CHANGE_SESSION") return action.scope === "SESSION_ONLY" ? this.selection.choose(action.sessionRef) : "Choose another workout today, or explicitly request a confirmed routine change.";
    if (action.type === "RESUME_WORKOUT") return this.lifecycle.resume(action.workoutRef);
    if (action.type === "FINISH_WORKOUT") {
      // The model can resolve natural wording only against an existing finish
      // choice. Local lexical evidence still gates every durable choice.
      const parsed = parseCompletionIntent(input);
      const requested = action.requestedCompletion;
      const text = input.toLowerCase();
      const explicitContinue = requested === "CONTINUE" && /\b(?:continue|keep going|resume)\b/.test(text);
      const matchesPendingChoice = (await this.refresh()).workout?.finishPending && (
        (requested === "COMPLETE" && /\b(?:save|mark|finish|complete)\b/.test(text) && !/\b(?:incomplete|partial|discard|delete)\b/.test(text)) ||
        (requested === "INCOMPLETE" && /\b(?:incomplete|partial)\b/.test(text) && /\b(?:save|mark|finish)\b/.test(text)) ||
        (requested === "CONTINUE" && /\b(?:continue|keep going|resume)\b/.test(text)) ||
        (requested === "DISCARD" && /\b(?:discard|delete|throw away)\b/.test(text))
      );
      const intent = parsed && parsed !== "REQUEST" ? parsed
        : parsed === "REQUEST" ? "REQUEST"
          : explicitContinue ? "CONTINUE"
            : matchesPendingChoice ? requested! : "REQUEST";
      return this.lifecycle.finish(`${this.key}:finish`, intent);
    }
    if (action.type === "QUERY_HISTORY" || action.type === "QUERY_ANALYTICS") return answerHistoryQuestion(await new AnalyticsQueries(this.db, this.userId).snapshot(), action);
    if (action.type === "LOG_SET" || action.type === "LOG_MULTIPLE_SETS") {
      const sets = action.type === "LOG_SET" ? [action.set] : action.sets;
      const supplied = numericEvidence(input);
      const current = await this.refresh();
      if(current.workout?.status!=="ACTIVE") return current.workout?.status==="PROPOSED"?"Reply START to begin your proposed workout before logging sets.":current.workout?.status==="PAUSED"?"Your workout is paused. Send RESUME before logging sets.":"Send START to choose and begin a workout before logging sets.";
      if(sets.some(set=>!Number.isInteger(set.reps)||set.reps<=0||set.loadValue!==undefined&&(!Number.isFinite(set.loadValue)||set.loadValue<0)))return "Send a nonnegative load and positive completed reps, such as 45x10. No set was recorded.";
      const refs = new Set(sets.map(set => set.exerciseRef ?? "current"));
      if (refs.size !== 1) return "Log one exercise at a time so I can resolve the target safely.";
      const ref = sets[0]?.exerciseRef;
      const target = resolveExerciseReference(ref??"current",current.exercises,current.workout.activeExerciseId);
      const targetId=target.status==="RESOLVED"?target.exercise.id:current.workout.activeExerciseId;
      const previous = current.sets.filter(set => set.exerciseId === targetId).at(-1);
      if (!hasSetCountEvidence(input, sets.length, sets.map(set => set.reps))) return "How many sets did you complete? Send one rep count for each set.";
      const loadSemantics = target.status==="RESOLVED"?target.exercise.loadSemantics:current.exercises.find(exercise=>exercise.id===current.workout?.activeExerciseId)?.loadSemantics;
      if (hasExplicitUnit(input, "KG") && hasExplicitUnit(input, "LB")) return "Which unit did you use for this set: kg or lb?";
      const explicitUnit = hasExplicitUnit(input, "KG") || hasExplicitUnit(input, "LB");
      if (sets.some(set => set.loadValue === undefined || (!supplied.includes(set.loadValue) && !(sets.length === 1 && /\b(?:same|again)\b/i.test(input) && previous?.load === set.loadValue)) || !supplied.includes(set.reps)
        || (set.weightUnit && !hasExplicitUnit(input, set.weightUnit) && (explicitUnit || set.weightUnit !== current.preferredWeightUnit))
        || (set.loadSemantics && set.loadSemantics !== loadSemantics && !/each|per.hand|per.side|total|stack|default/i.test(input)))) return "Send the load and reps explicitly before I record a set.";
      if (sets.some(set => set.loadSemantics === "PER_HAND_PER_SIDE" && set.loadSemantics !== loadSemantics && !hasPerHandEvidence(input, set.loadValue!))) return "Is that load per hand, or the total load? Your sets are unchanged.";
      if (sets.some(set => set.loadSemantics && set.loadSemantics !== loadSemantics && set.loadSemantics !== "PER_HAND_PER_SIDE")) return "Use the exercise's confirmed load convention, or specify the convention in your exercise settings.";
      const text = sets.map(set => `${set.loadValue} ${set.weightUnit ?? ""} ${set.loadSemantics === "PER_HAND_PER_SIDE" ? "each " : "x "}${set.reps}`).join(", ");
      if (ref) {
        const result = await this.commands.dispatch({ type: "LOG_CONTEXT_SETS", exerciseRef: ref, setText: text }, input, `${this.key}:us4`);
        const recorded = (await this.db.query(`select id,session_exercise_id as "exerciseId",set_index as index,load_value::float8 as load,weight_unit as unit,load_semantics as semantics,reps
          from workout_sets where user_id=$1 and source_message_id=$2 and status='RECORDED' order by set_index`, [this.userId, this.key])).rows;
        return recorded.length ? `Logged: ${recorded.map(formatSetFact).join(", ")}` : result;
      }
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
