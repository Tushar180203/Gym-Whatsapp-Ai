import type { IntentInterpreter } from "../../../ai/src/interfaces.js";
import { parseProposedActionEnvelope, type ProposedAction, type SetInput } from "../../../contracts/src/ai/actions.js";
import { type Us4Action, type ReplaceWorkoutAction } from "../parser/us4-parser.js";
import { isCoachingQuestion, parseHistoryQuestion } from "../messaging/history-query-parser.js";
import { parseStartIntent } from "../workouts/start-intent.js";
import { parseCompletionIntent } from "../workouts/completion-policy.js";
import { isResumeIntent } from "../workouts/resume-workout-command.js";
import { normalizeMessage, parseConversationGrammar, explicitScope, isScopeAnswer } from "./grammar.js";
import { resolveExerciseReference } from "./references.js";
import { formatConversationResponse, formatSetFact, type ConversationResponse } from "./responses.js";
import { conversationMode, type ConversationContext, type ConversationState, type PendingFrame } from "./state.js";

export type ConversationTrace = {
  conversationMode: ConversationState["mode"]; routeStage: string; pendingActionType?: string;
  resolvedIntent?: string; aiInvoked: boolean; aiActionType?: string; clarificationReason?: string;
  confirmationRequired: boolean; executionResult: string;
};
export interface ConversationPorts {
  userId: string;
  key: string;
  now(): number;
  load(): Promise<{ state: ConversationState; context: ConversationContext }>;
  refresh(): Promise<ConversationContext>;
  save(state: ConversationState): Promise<void>;
  cancel(): Promise<void>;
  confirm(text: string): Promise<{ body: string; applied: boolean }>;
  execute(action: Us4Action | ReplaceWorkoutAction, input: string, step?: string): Promise<string>;
  log(notation: string, next?: boolean): Promise<string>;
  deterministic(text: string): Promise<string | undefined>;
  plan(): Promise<string>;
  workoutChoices?(): Promise<Array<{ id: string; name: string }>>;
  resolveIdentity?(reference: string): Promise<Array<{ id: string; name: string; aliases: string[] }>>;
  interpreter?: IntentInterpreter;
  beforeAi?(): void;
  observe?(trace: ConversationTrace): void;
}

// Orchestration never writes workout data: every effect passes through an owner-locked command port.
export class ConversationOrchestrator {
  private state!: ConversationState;
  private context!: ConversationContext;
  private trace!: ConversationTrace;
  constructor(private readonly ports: ConversationPorts) {}

  async process(input: string, eventAt?: number): Promise<string> {
    ({ state: this.state, context: this.context } = await this.ports.load());
    this.state.mode = conversationMode(this.context);
    this.trace = { conversationMode: this.state.mode, routeStage: "RECOVERY", aiInvoked: false, confirmationRequired: false, executionResult: "REPLIED" };
    if (eventAt !== undefined && this.state.lastEventAt !== null && eventAt < this.state.lastEventAt) { this.trace.executionResult = "IGNORED_OLDER"; return this.finish({ type: "OlderEvent" }, false); }
    const text = normalizeMessage(input);
    const grammar = parseConversationGrammar(text);
    const hadPending = this.state.stack.length > 0;
    const expired = hadPending && this.state.expiresAt !== null && this.state.expiresAt <= this.ports.now();
    const stale = hadPending && (this.state.workoutId !== (this.context.workout?.id ?? null) || this.state.workoutVersion !== (this.context.workout?.version ?? null));
    if (expired || stale) {
      if (this.state.stack.some(f => f.kind === "CUSTOM" && f.confirmationId === this.context.confirmation?.id)) await this.ports.cancel();
      this.clear();
      if ((!grammar && !parseStartIntent(text) && !parseCompletionIntent(text) && !isResumeIntent(text) && !parseHistoryQuestion(text)) || /^(yes|confirm|no|today|permanent(?:ly)?|first|second|\d+)$/i.test(text)) return this.finish({ type: expired ? "Expired" : "Stale" });
    }
    if (eventAt !== undefined) this.state.lastEventAt = eventAt;

    if (grammar?.kind === "CANCEL" || grammar?.kind === "BACK") {
      this.trace.routeStage = "CONTROL";
      if (grammar.kind === "BACK" && this.state.stack.length > 1) { this.state.stack.pop(); await this.ports.cancel(); return this.finish(await this.continueReplacement()); }
      await this.ports.cancel(); this.clear(); return this.finish({ type: "Cancelled" });
    }
    if (/^(yes|confirm|no)$/i.test(text) && (this.context.confirmation || !this.state.stack.length)) {
      this.trace.routeStage = "CONFIRMATION";
      const result = await this.ports.confirm(text);
      this.trace.executionResult = result.applied ? "APPLIED" : "RESOLVED";
      const child = this.state.stack.at(-1);
      if (child?.kind === "CUSTOM" && child.confirmationId === this.context.confirmation?.id) {
        this.state.stack.pop();
        if (!result.applied) { this.clear(); return this.finish({ type: "DomainResult", body: result.body }); }
        this.context = await this.ports.refresh();
        return this.finish(await this.continueReplacement());
      }
      return this.finish({ type: "DomainResult", body: result.body });
    }
    if (/^(yes|confirm|no)$/i.test(text) && this.state.stack.length) {
      this.trace.routeStage = "CLARIFICATION";
      if (/^no$/i.test(text)) { this.clear(); return this.finish({ type: "Cancelled" }); }
      return this.finish(this.recovery());
    }
    if (grammar?.kind === "HELP" || grammar?.kind === "REPEAT" || grammar?.kind === "SOCIAL") {
      this.trace.routeStage = grammar.kind === "SOCIAL" ? "SOCIAL" : "CONTROL";
      return this.finish({ type: grammar.kind === "SOCIAL" ? "Greeting" : "Help", context: this.context, state: this.state });
    }
    if (grammar?.kind === "FACT") {
      this.trace.routeStage = "FACT";
      return this.finish(await this.fact(grammar.query));
    }
    if (grammar?.kind === "REJECT_TARGET") {
      this.trace.routeStage = "CLARIFICATION";
      if (this.context.confirmation) await this.ports.cancel();
      if (this.state.stack.at(-1)?.kind === "CUSTOM") this.state.stack.pop();
      const parent = this.state.stack.find(f => f.kind === "REPLACE");
      if (parent?.kind === "REPLACE") {
        if (parent.slot === "SOURCE") parent.source = null; else parent.replacement = null;
        return this.finish(await this.continueReplacement());
      }
      return this.finish(this.question("Which exact exercise or set do you mean? I haven't changed your recorded data.", "REJECTED_TARGET"));
    }
    if (grammar?.kind === "REPAIR_EXERCISE") {
      this.clear(); this.push({ kind: "REPAIR_EXERCISE", exerciseRef: grammar.reference.slice(0, 120), recentSetId: this.context.sets.at(-1)?.id ?? null });
      return this.finish(this.question(`Do you mean switching to ${grammar.reference.slice(0, 120)}, or correcting a recorded set? I haven't changed either.`, "AMBIGUOUS_SELF_REPAIR"));
    }
    if (grammar?.kind === "PERMANENT_RECENT") {
      this.trace.routeStage = "SESSION_CHANGE";
      const recent = this.state.recentChange;
      if (!recent || recent.expiresAt <= this.ports.now()) return this.finish(this.question("Which change should update your routine? Tell me the exercise and replacement.", "MISSING_RECENT_CHANGE"));
      if (recent.workoutId !== this.context.workout?.id || recent.workoutVersion !== this.context.workout.version) return this.finish({ type: "Stale" });
      this.state.recentChange = null;
      return this.finish(await this.action(recent.action as ProposedAction, "make that change permanent"));
    }
    const lifecycleChoice = parseStartIntent(text);
    if (lifecycleChoice && lifecycleChoice.kind !== "START") {
      this.trace.routeStage = "DOMAIN";
      const body = await this.ports.deterministic(text);
      if (body !== undefined) { this.clear(); return this.finish({ type: "DomainResult", body }); }
    }
    const factualQuestion = parseHistoryQuestion(text);
    if (factualQuestion) { this.trace.routeStage = "FACT"; return this.finish(await this.action(factualQuestion, text)); }
    if (isCoachingQuestion(text)) {
      this.trace.routeStage = "FACT";
      const body = await this.ports.deterministic(text);
      if (body !== undefined) return this.finish({ type: "HistoryFact", body });
    }
    if (parseCompletionIntent(text) || isResumeIntent(text)) {
      this.trace.routeStage = "DOMAIN";
      const body = await this.ports.deterministic(text);
      if (body !== undefined) return this.finish({ type: "DomainResult", body });
    }
    const pending = await this.answerPending(text, grammar === undefined);
    if (pending) { this.trace.routeStage = "CLARIFICATION"; return this.finish(pending); }
    if (!grammar && /\d+\s*(?:kg|lb)?\s*x\s*\d+.*\b(?:and|then)\b/i.test(text)) return this.finish(this.question("Send the set and the other request separately so I can apply them safely.", "UNSUPPORTED_COMPOUND"));
    if (grammar?.kind === "REPAIR_VALUE") {
      const matches = this.context.sets.filter(s => s.exerciseId === this.context.workout?.activeExerciseId && s.index === grammar.ordinal);
      if (matches.length !== 1) return this.finish(this.question("Which exercise and set do you mean?", "AMBIGUOUS_SET"));
      this.push({ kind: "REPAIR_VALUE", targetRef: matches[0]!.id, value: grammar.value });
      return this.finish(this.question(`Is ${grammar.value} the load or the completed reps?`, "AMBIGUOUS_FIELD"));
    }
    if (grammar?.kind === "REPAIR_PREVIOUS_VALUE") {
      const target = this.context.sets.at(-1);
      if (!target || (target.load !== grammar.previous && target.reps !== grammar.previous)) return this.finish(this.question("Which exercise and set had that value?", "AMBIGUOUS_CORRECTION_TARGET"));
      if (target.load === grammar.previous && target.reps === grammar.previous) {
        this.push({ kind: "REPAIR_VALUE", targetRef: target.id, value: grammar.value });
        return this.finish(this.question(`Is ${grammar.value} the load or the completed reps?`, "AMBIGUOUS_FIELD"));
      }
      return this.finish(await this.action({ type: "CORRECT_SET", targetRef: target.id, replacement: target.load === grammar.previous ? { loadValue: grammar.value } : { reps: grammar.value } }, text));
    }
    if (grammar?.kind === "DEFER") {
      this.trace.routeStage = "SESSION_CHANGE";
      const target = resolveExerciseReference(grammar.exerciseRef, this.context.exercises, this.context.workout?.activeExerciseId ?? null);
      if (target.status !== "RESOLVED") return this.finish(this.question("Which exercise should I move later?", "AMBIGUOUS_EXERCISE"));
      const next = this.context.exercises.find(e => e.order > target.exercise.order && e.status !== "SKIPPED");
      if (!next) return this.finish(this.question("No later exercise is available. Choose another exercise or finish.", "NO_NEXT_EXERCISE"));
      this.clear();
      await this.ports.execute({ type: "REORDER_EXERCISE", exerciseRef: target.exercise.id, ordinal: this.context.exercises.length }, text, "defer-order");
      return this.finish({ type: "DomainResult", body: await this.ports.execute({ type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: next.id }, text, "defer-active") });
    }
    if (grammar?.kind === "REPLACE") {
      this.trace.routeStage = "SESSION_CHANGE";
      if ((grammar.source?.length ?? 0) > 120 || (grammar.replacement?.length ?? 0) > 120) return this.finish(this.question("Use a short exercise name for the exercise and replacement.", "INVALID_REFERENCE"));
      this.clear(); this.push({ ...grammar, kind: "REPLACE", slot: grammar.source ? grammar.replacement ? "SCOPE" : "REPLACEMENT" : "SOURCE" });
      return this.finish(await this.continueReplacement());
    }
    if (grammar?.kind === "LOG" || grammar?.kind === "LOG_NEXT") {
      this.trace.routeStage = "SET";
      this.trace.resolvedIntent = grammar.kind;
      const body = await this.ports.log(grammar.notation, grammar.kind === "LOG_NEXT");
      return this.finish({ type: "SetLogged", body, ...(grammar.kind === "LOG_NEXT" ? {} : this.activeName()) });
    }
    if (grammar?.kind === "REPS") {
      this.trace.routeStage = "SET";
      if (grammar.reps < 1) return this.finish(this.question("How many completed reps?", "INVALID_REPS"));
      const previous = [...this.context.sets].reverse().find(s => s.exerciseId === this.context.workout?.activeExerciseId);
      if (previous) return this.finish({ type: "SetLogged", body: await this.ports.log(`same x ${grammar.reps}`), ...this.activeName() });
      this.push({ kind: "LOAD", reps: grammar.reps }); return this.finish(this.question(`What load did you use for those ${grammar.reps} reps?`, "MISSING_LOAD"));
    }
    if (grammar?.kind === "SAME") {
      const previous = [...this.context.sets].reverse().find(s => s.exerciseId === this.context.workout?.activeExerciseId);
      if (!previous) return this.finish(this.question("I can't resolve same here. Send the load and completed reps.", "AMBIGUOUS_SAME"));
      this.push({ kind: "SAME_REPS", referenceSetId: previous.id });
      return this.finish(this.question("Same load. How many completed reps?", "MISSING_REPS"));
    }
    if (grammar?.kind === "ACTION") {
      this.trace.routeStage = "DOMAIN";
      return this.finish(await this.action(grammar.action, text));
    }
    this.trace.routeStage = "DETERMINISTIC";
    const deterministic = await this.ports.deterministic(text);
    if (deterministic !== undefined) return this.finish(/^No pending scope question/.test(deterministic) ? { type: "Expired" } : { type: "DomainResult", body: deterministic });
    if (!this.ports.interpreter) return this.finish(this.recovery());
    this.trace.routeStage = "AI"; this.trace.aiInvoked = true;
    const parent = this.state.stack.find(f => f.kind === "REPLACE");
    let envelope;
    try {
      this.ports.beforeAi?.();
      envelope = parseProposedActionEnvelope(await this.ports.interpreter.interpret({ userInput: text, idempotencyKey: this.ports.key, context: {
        userId: this.ports.userId, activeWorkout: this.state.mode === "WORKOUT_ACTIVE" || this.state.mode === "WORKOUT_FINISH_PENDING",
        ...(this.activeName().exerciseName ? { activeExercise: this.activeName().exerciseName } : {}),
        knownExerciseRefs: this.context.identities.slice(0, 100).map(e => e.name),
        confirmedAliases: this.context.identities.flatMap(e => e.aliases.map(alias => ({ alias, exerciseRef: e.name }))).slice(0, 100),
        conversationMode: this.state.mode, pendingAction: this.state.stack.at(-1)?.kind ?? null,
        ...(parent?.kind === "REPLACE" ? { pendingOperation: { type: "REPLACE_EXERCISE" as const,
          sourceExercise: this.context.exercises.find(e => e.id === parent.source)?.name ?? parent.source,
          replacementExercise: this.context.identities.find(e => e.id === parent.replacement)?.name ?? parent.replacement,
          scope: parent.scope, awaiting: parent.slot } } : {}),
        allowedActionTypes: ["START_WORKOUT", "RESUME_WORKOUT", "CORRECT_SET", "DELETE_SET", "CHANGE_ACTIVE_EXERCISE", "REPLACE_EXERCISE", "ADD_EXERCISE", "SKIP_EXERCISE", "CHANGE_SESSION", "CREATE_CUSTOM_EXERCISE", "MAP_EXERCISE_ALIAS", "UPDATE_ROUTINE_REQUEST", "QUERY_HISTORY", "QUERY_ANALYTICS", "FINISH_WORKOUT", "UNKNOWN", ...(this.state.mode === "WORKOUT_ACTIVE" ? ["LOG_SET", "LOG_MULTIPLE_SETS"] : [])]
      } }));
    } catch { this.trace.executionResult = "AI_FAILED"; return this.finish(this.recovery()); }
    this.trace.aiActionType = envelope.action.type;
    if (envelope.confidence === "low" || envelope.requiresClarification) {
      // Recover supported parent intent without trusting low-confidence targets or numeric fields.
      this.trace.clarificationReason = "AI_AMBIGUITY";
      if (envelope.action.type === "QUERY_HISTORY" || envelope.action.type === "QUERY_ANALYTICS") {
        if (this.state.stack.length < 3) this.push({ kind: "QUERY", action: envelope.action });
        return this.finish(this.question("Which exact exercise, workout session or muscle do you mean?", "AI_AMBIGUITY"));
      }
      if (!this.state.stack.length && envelope.action.type === "REPLACE_EXERCISE") {
        this.push({ kind: "REPLACE", source: null, replacement: envelope.action.toExerciseRef, scope: "AMBIGUOUS", slot: "SOURCE" });
        return this.finish(this.question("Which exercise in this workout should I replace?", "AI_AMBIGUITY"));
      }
      return this.finish(this.state.stack.length ? this.recovery() : this.question("Which exercise or change do you mean? You can also say START, log a set, or ask about your plan.", "AI_AMBIGUITY"));
    }
    if (envelope.action.type === "UNKNOWN") return this.finish(this.recovery());
    if ((envelope.action.type === "LOG_SET" || envelope.action.type === "LOG_MULTIPLE_SETS") && /^(?:actually|sorry|correct|fix|change|i meant)\b/i.test(text)) return this.finish(this.question("Which set should I correct, and what are the correct load and reps?", "CORRECTION_NOT_NEW_SET"));
    return this.finish(await this.action(envelope.action, text));
  }

  private activeName(): { exerciseName?: string } {
    const name = this.context.exercises.find(e => e.id === this.context.workout?.activeExerciseId)?.name;
    return name ? { exerciseName: name } : {};
  }
  private clear() { this.state.stack = []; this.state.expiresAt = null; this.state.lastQuestion = null; this.state.recentChange = null; }
  private push(frame: PendingFrame) {
    if (this.state.stack.length >= 3) throw new Error("Conversation continuation limit exceeded");
    this.state.stack.push(frame); this.state.expiresAt = this.ports.now() + 600_000;
    this.state.workoutId = this.context.workout?.id ?? null; this.state.workoutVersion = this.context.workout?.version ?? null;
  }
  private question(question: string, reason: string): ConversationResponse {
    this.state.lastQuestion = question.slice(0, 512); this.trace.clarificationReason = reason;
    return { type: "Clarification", question };
  }
  private recovery(): ConversationResponse { return { type: "Recovery", context: this.context, state: this.state }; }
  private async finish(response: ConversationResponse, persist = true): Promise<string> {
    if (this.trace.executionResult === "REPLIED") {
      if (["HistoryFact", "Plan", "Greeting", "Help"].includes(response.type)) this.trace.executionResult = "READ_ONLY";
      else if (response.type === "Clarification" || this.trace.clarificationReason) this.trace.executionResult = "CLARIFIED";
      else if (response.type === "Confirmation") this.trace.executionResult = "CONFIRMATION_REQUIRED";
      else if (response.type === "SetLogged" && response.body.startsWith("Logged")) this.trace.executionResult = "APPLIED";
      else if (response.type === "DomainResult" && /applied\./.test(response.body)) this.trace.executionResult = "APPLIED";
    }
    if (persist) {
      const refreshed = await this.ports.refresh();
      this.state.mode = conversationMode(refreshed);
      if (!this.state.stack.length) { this.state.workoutId = refreshed.workout?.id ?? null; this.state.workoutVersion = refreshed.workout?.version ?? null; }
      const active = refreshed.workout?.activeExerciseId;
      if (active && active !== this.context.workout?.activeExerciseId) this.state.recentExerciseId = this.context.workout?.activeExerciseId ?? active;
      const last = refreshed.sets.at(-1); this.state.recentSetId = last?.id ?? null;
      this.state.version++; await this.ports.save(this.state);
      this.trace.confirmationRequired = Boolean(refreshed.confirmation);
    }
    const pendingKind = this.state.stack.at(-1)?.kind;
    if (pendingKind) this.trace.pendingActionType = pendingKind;
    this.ports.observe?.(this.trace);
    return formatConversationResponse(response);
  }
  private async fact(query: "PLAN" | "CURRENT" | "NEXT" | "LAST_SET" | "SETS"): Promise<ConversationResponse> {
    if (query === "PLAN") return { type: "Plan", body: await this.ports.plan() };
    const exercise = this.context.exercises.find(e => e.id === this.context.workout?.activeExerciseId);
    if (query === "CURRENT") return { type: "HistoryFact", body: exercise ? `You're on ${exercise.name}.` : "No exercise is active. Send START to train." };
    if (query === "NEXT") {
      const r = resolveExerciseReference("next", this.context.exercises, exercise?.id ?? null);
      return { type: "HistoryFact", body: r.status === "RESOLVED" ? `Next: ${r.exercise.name}.` : "No next planned exercise. You can choose an exercise or finish." };
    }
    if (query === "LAST_SET") {
      const last = this.context.sets.at(-1);
      return { type: "HistoryFact", body: last ? `Last set: ${formatSetFact(last)}.` : "No recorded set in this workout." };
    }
    const count = exercise?.recordedSets ?? this.context.sets.filter(s => s.exerciseId === exercise?.id).length;
    return { type: "HistoryFact", body: exercise ? `${exercise.name}: ${count} recorded sets; ${exercise.plannedSets === null || exercise.plannedSets === undefined ? "no planned count" : `${Math.max(0, exercise.plannedSets - count)} planned sets remaining`}.` : "No exercise is active." };
  }

  private async answerPending(text: string, freeAnswer: boolean): Promise<ConversationResponse | undefined> {
    const frame = this.state.stack.at(-1);
    if (!frame) return undefined;
    if (frame.kind === "REPAIR_EXERCISE" && freeAnswer) {
      if (/^(?:switch|active|current exercise)$/i.test(text)) { this.clear(); return this.action({ type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: frame.exerciseRef }, text); }
      if (/^(?:set|recorded set|last set)$/i.test(text)) return this.question("I won't move a recorded set between exercises from an uncertain reference. Specify corrected load/reps, or delete and relog the set under the right exercise.", "EXERCISE_REPAIR_POLICY");
    }
    if (frame.kind === "QUERY" && freeAnswer && !/\b(?:show|what|how|when|start|done|actually|replace|add|delete)\b/i.test(text) && text.length <= 120) {
      const action = frame.action;
      if (action.type !== "QUERY_HISTORY" && action.type !== "QUERY_ANALYTICS") return this.recovery();
      this.state.stack.pop();
      const kind = action.subject?.kind ?? (action.type === "QUERY_HISTORY" ? action.queryKind === "LAST_SESSION" ? "ROUTINE_SESSION" : "EXERCISE" : "MUSCLE");
      const subject = kind === "MUSCLE" ? { kind: "MUSCLE" as const, muscleRef: text } : kind === "ROUTINE_SESSION" || kind === "ROUTINE" || kind === "WORKOUT_SESSION" ? { kind: "ROUTINE_SESSION" as const, sessionRef: text } : { kind: "EXERCISE" as const, exerciseRef: text };
      const result = await this.action({ ...action, subject } as ProposedAction, text);
      const parent = this.state.stack.at(-1);
      if (parent?.kind === "REPLACE") this.state.lastQuestion = parent.slot === "SCOPE" ? "Today only or update your routine?" : parent.slot === "SOURCE" ? "Which exercise should I replace?" : "Replace it with which exercise?";
      return result;
    }
    if (frame.kind === "CUSTOM") return freeAnswer ? this.recovery() : undefined;
    if (frame.kind === "ACTIVE_CHOICE") {
      if (/^replace$/i.test(text)) {
        const candidates = await this.ports.workoutChoices?.() ?? [];
        this.clear(); this.push({ kind: "WORKOUT_REPLACE", candidates });
        return this.question(`Replace with which workout? ${candidates.map((c, i) => `${i + 1}. ${c.name}`).join("; ")}`, "MISSING_REPLACEMENT_WORKOUT");
      }
      if (isResumeIntent(text) || parseCompletionIntent(text)) {
        this.clear(); const body = await this.ports.deterministic(text);
        if (body !== undefined) return { type: "DomainResult", body };
      }
    }
    if (frame.kind === "WORKOUT_REPLACE" && freeAnswer) {
      const ordinal = text.match(/^(?:the )?(first|second|third|\d+)(?: one)?$/i);
      const index = ordinal ? ({ first: 1, second: 2, third: 3 } as Record<string, number>)[ordinal[1]!.toLowerCase()] ?? Number(ordinal[1]) : 0;
      const candidates = frame.candidates.filter((c, i) => index ? i === index - 1 : c.name.toLowerCase() === text.toLowerCase());
      if (candidates.length !== 1) return this.question("Choose the exact replacement workout name or position.", "AMBIGUOUS_SESSION");
      this.clear(); return { type: "Confirmation", body: await this.ports.execute({ type: "REPLACE_WORKOUT", sessionRef: candidates[0]!.id }, "replace workout") };
    }
    if (frame.kind === "REPLACE") {
      const scope = explicitScope(text);
      if (frame.slot === "SCOPE" && scope !== "AMBIGUOUS" && isScopeAnswer(text)) { frame.scope = scope; return this.continueReplacement(); }
      if ((frame.slot === "REPLACEMENT" || frame.slot === "SOURCE") && freeAnswer && !/\b(?:show|what|how|when|start|done|actually)\b/i.test(text) && text.length <= 120) {
        if (frame.slot === "SOURCE") frame.source = text; else frame.replacement = text;
        return this.continueReplacement();
      }
    } else if (frame.kind === "SCOPE" && explicitScope(text) !== "AMBIGUOUS" && isScopeAnswer(text)) {
      this.clear();
      const scope = explicitScope(text);
      if (frame.action.type === "UPDATE_ROUTINE_REQUEST" && scope === "SESSION_ONLY") {
        const change = frame.action.requestedChange;
        if (!("sessionRef" in change) || !["current", this.context.workout?.name, this.context.workout?.templateId].includes(change.sessionRef)) return this.question("Which exercise in this workout should change today?", "OTHER_SESSION_TARGET");
        if (change.operation === "REPLACE_EXERCISE") return this.action({ type: "REPLACE_EXERCISE", fromExerciseRef: change.fromExerciseRef, toExerciseRef: change.toExerciseRef, scope }, text);
        if (change.operation === "ADD_EXERCISE") return this.action({ type: "ADD_EXERCISE", exerciseRef: change.exerciseRef, scope }, text);
        if (change.operation === "REMOVE_EXERCISE") return this.action({ type: "SKIP_EXERCISE", exerciseRef: change.exerciseRef, scope }, text);
        return this.question("Specify the session-only exercise change.", "UNSUPPORTED_SESSION_CHANGE");
      }
      return this.action({ ...frame.action, scope } as ProposedAction, text);
    } else if (frame.kind === "LOAD") {
      const match = text.match(/^(\d+(?:\.\d+)?)\s*(kg|lb)?$/i);
      if (match) { this.clear(); return { type: "SetLogged", body: await this.ports.log(`${match[1]} ${match[2] ?? ""} x ${frame.reps}`), ...this.activeName() }; }
    } else if (frame.kind === "REPAIR_VALUE" && /^(?:load|weight|reps|kg|lb)$/i.test(text)) {
      this.clear();
      const field = /reps/i.test(text) ? "reps" : "loadValue";
      return this.action({ type: "CORRECT_SET", targetRef: frame.targetRef, replacement: { [field]: frame.value, ...(/^(kg|lb)$/i.test(text) ? { weightUnit: text.toUpperCase() as "KG" | "LB" } : {}) } }, `${frame.value} ${text}`);
    } else if (frame.kind === "SAME_REPS" && /^\d+(?: reps)?$/i.test(text)) {
      const reps = Number(text.split(" ")[0]);
      const previous = this.context.sets.find(s => s.id === frame.referenceSetId && s.exerciseId === this.context.workout?.activeExerciseId);
      if (!previous || reps < 1) return this.question("Send a positive completed rep count, or the explicit load and reps.", "INVALID_SAME_CONTEXT");
      this.clear(); return { type: "SetLogged", body: await this.ports.log(`same x ${reps}`), ...this.activeName() };
    } else if (frame.kind === "START" && freeAnswer) {
      const ordinal = text.match(/^(?:the )?(first|second|third|\d+)(?: one)?$/i);
      const index = ordinal ? ({ first: 1, second: 2, third: 3 } as Record<string, number>)[ordinal[1]!.toLowerCase()] ?? Number(ordinal[1]) : 0;
      const candidates = frame.candidates.filter((c, i) => index ? i === index - 1 : c.name.toLowerCase() === text.toLowerCase());
      if (candidates.length === 1) { this.clear(); return this.action({ type: "START_WORKOUT", sessionRef: candidates[0]!.id }, text); }
      if (/^(?:start|choose|replace|rest)\b/i.test(text)) return undefined;
      return this.question("Which routine/session? Choose its exact name or position.", "AMBIGUOUS_SESSION");
    } else if ((frame.kind === "TARGET" || frame.kind === "CORRECTION") && freeAnswer) {
      const resolution = resolveExerciseReference(text, this.context.exercises.filter(e => frame.kind === "CORRECTION" || frame.candidates.includes(e.id)), this.context.workout?.activeExerciseId ?? null, this.state.recentExerciseId);
      if (resolution.status === "RESOLVED") {
        this.clear();
        if (frame.kind === "CORRECTION") return this.action({ type: "CORRECT_SET", targetRef: `exercise:${resolution.exercise.identityId}:last`, replacement: frame.replacement as Partial<SetInput> }, Object.values(frame.replacement).join(" "));
        const action = frame.action;
        return this.action({ ...action, exerciseRef: resolution.exercise.identityId } as ProposedAction, text);
      }
    }
    return undefined;
  }

  private async continueReplacement(): Promise<ConversationResponse> {
    const frame = this.state.stack.find(f => f.kind === "REPLACE");
    if (!frame || frame.kind !== "REPLACE") return this.recovery();
    if (!frame.source) { frame.slot = "SOURCE"; return this.question("Which exercise should I replace?", "MISSING_SOURCE"); }
    const source = resolveExerciseReference(frame.source, this.context.exercises, this.context.workout?.activeExerciseId ?? null, this.state.recentExerciseId);
    if (source.status !== "RESOLVED") { frame.slot = "SOURCE"; return this.question("Which exercise in this workout should I replace?", "AMBIGUOUS_EXERCISE"); }
    frame.source = source.exercise.id;
    if (!frame.replacement) { frame.slot = "REPLACEMENT"; return this.question(`Replace ${source.exercise.name} with what?`, "MISSING_REPLACEMENT"); }
    const replacement = this.context.identities.filter(e => e.id === frame.replacement || [e.name, ...e.aliases].some(n => n.toLowerCase() === frame.replacement!.toLowerCase()));
    const sessionResolved = resolveExerciseReference(frame.replacement, this.context.exercises, this.context.workout?.activeExerciseId ?? null);
    if (!replacement.length) replacement.push(...await this.ports.resolveIdentity?.(frame.replacement) ?? []);
    if (!replacement.length && sessionResolved.status === "RESOLVED") replacement.push({ id: sessionResolved.exercise.identityId, name: sessionResolved.exercise.name, aliases: [] });
    if (replacement.length > 1 || sessionResolved.status === "AMBIGUOUS") { frame.slot = "REPLACEMENT"; return this.question("That name matches more than one exercise. Which exact replacement?", "ALIAS_CONFLICT"); }
    if (!replacement.length) {
      if (this.context.confirmation) return { type: "Confirmation", body: "Resolve the pending change with yes/confirm or no/cancel first." };
      const body = await this.ports.execute({ type: "CREATE_CUSTOM_EXERCISE", name: frame.replacement }, frame.replacement);
      this.context = await this.ports.refresh();
      if (this.context.confirmation?.actionType === "CREATE_CUSTOM_EXERCISE") this.push({ kind: "CUSTOM", name: frame.replacement, confirmationId: this.context.confirmation.id });
      this.state.lastQuestion = body.slice(0, 512);
      return { type: "Confirmation", body };
    }
    frame.replacement = replacement[0]!.id;
    if (frame.scope === "AMBIGUOUS") { frame.slot = "SCOPE"; return this.question("Today only or update your routine?", "AMBIGUOUS_SCOPE"); }
    const action: ProposedAction = { type: "REPLACE_EXERCISE", fromExerciseRef: source.exercise.id, toExerciseRef: replacement[0]!.id, scope: frame.scope };
    const input = `replace ${source.exercise.name} with ${replacement[0]!.name}${frame.scope === "SESSION_ONLY" ? " today" : " permanently"}`;
    this.clear(); this.trace.resolvedIntent = action.type;
    const body = await this.ports.execute(action, input);
    const changed = await this.ports.refresh();
    if (frame.scope === "SESSION_ONLY" && /applied\./.test(body) && changed.workout?.templateId) this.state.recentChange = {
      action: { type: "UPDATE_ROUTINE_REQUEST", scope: "PERMANENT_ROUTINE", requestedChange: { operation: "REPLACE_EXERCISE", sessionRef: changed.workout.templateId, fromExerciseRef: source.exercise.identityId, toExerciseRef: replacement[0]!.id } },
      workoutId: changed.workout.id, workoutVersion: changed.workout.version, expiresAt: this.ports.now() + 600_000
    };
    return { type: "DomainResult", body };
  }

  private async action(action: Us4Action, input: string): Promise<ConversationResponse> {
    this.trace.resolvedIntent = action.type;
    if (action.type === "CORRECT_SET") {
      const supplied = (input.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
      if ([action.replacement.reps, action.replacement.loadValue].some(value => value !== undefined && !supplied.includes(value))
        || (action.replacement.weightUnit && !new RegExp(`\\b${action.replacement.weightUnit}\\b`, "i").test(input))
        || (action.replacement.loadSemantics && !/each|per.hand|per.side|total|stack|default/i.test(input))) return this.question("Please provide the corrected numeric value and unit explicitly.", "UNSUPPLIED_CORRECTION_VALUE");
    }
    if (action.type === "REPLACE_EXERCISE") {
      this.clear(); this.push({ kind: "REPLACE", source: action.fromExerciseRef ?? "current", replacement: action.toExerciseRef, scope: action.scope === "PERMANENT_ROUTINE" && explicitScope(input) !== "PERMANENT_ROUTINE" ? "AMBIGUOUS" : action.scope, slot: "SOURCE" });
      return this.continueReplacement();
    }
    if ("scope" in action && action.scope === "AMBIGUOUS") {
      this.clear(); this.push({ kind: "SCOPE", action: action as ProposedAction });
      return this.question("Today only or update your routine?", "AMBIGUOUS_SCOPE");
    }
    if ("scope" in action && action.scope === "PERMANENT_ROUTINE" && explicitScope(input) !== "PERMANENT_ROUTINE") {
      this.clear(); this.push({ kind: "SCOPE", action: { ...action, scope: "AMBIGUOUS" } as ProposedAction });
      return this.question("Today only or update your routine?", "PERMANENT_INTENT_UNPROVEN");
    }
    if (action.type === "START_WORKOUT") {
      if (this.context.workout?.status === "PROPOSED" && !action.sessionRef && !action.routineRef) return { type: "DomainResult", body: (await this.ports.deterministic("start planned"))! };
      if (!this.context.workout && !action.sessionRef && !action.routineRef && this.context.choices.length > 1) {
        this.push({ kind: "START", candidates: this.context.choices });
        return this.question(`Which routine/session? ${this.context.choices.map((c, i) => `${i + 1}. ${c.name}`).join("; ")}`, "AMBIGUOUS_SESSION");
      }
      if (this.context.workout && this.context.workout.status !== "PROPOSED") {
        this.clear(); this.push({ kind: "ACTIVE_CHOICE" });
        const body = await this.ports.execute(action, input); this.state.lastQuestion = body.slice(0, 512);
        return { type: "Clarification", question: body };
      }
    }
    if (action.type === "CHANGE_ACTIVE_EXERCISE" || action.type === "REORDER_EXERCISE" || action.type === "SKIP_EXERCISE") {
      const resolution = resolveExerciseReference(action.exerciseRef ?? "current", this.context.exercises, this.context.workout?.activeExerciseId ?? null, this.state.recentExerciseId);
      if (resolution.status === "RESOLVED") action = { ...action, exerciseRef: resolution.exercise.id };
      else if (action.type !== "REORDER_EXERCISE") {
        this.push({ kind: "TARGET", action, candidates: (resolution.status === "AMBIGUOUS" ? resolution.candidates : this.context.exercises).map(e => e.id) });
        return this.question("Which exercise in this workout do you mean?", "AMBIGUOUS_EXERCISE");
      }
    }
    if (action.type === "CORRECT_SET" && !action.targetRef && !this.context.sets.length) {
      this.push({ kind: "CORRECTION", replacement: action.replacement, candidates: [] });
      return this.question("Which exercise and set should I correct?", "MISSING_CORRECTION_TARGET");
    }
    if (action.type === "CORRECT_SET" && /^set:\d+$/.test(action.targetRef ?? "")) {
      const ordinal = Number(action.targetRef!.slice(4));
      const candidates = this.context.sets.filter(s => s.exerciseId === this.context.workout?.activeExerciseId && s.index === ordinal);
      if (candidates.length !== 1) return this.question("Which exercise and set do you mean?", "AMBIGUOUS_SET");
      action = { ...action, targetRef: candidates[0]!.id };
    }
    const body = await this.ports.execute(action, input);
    if ((action.type === "QUERY_HISTORY" || action.type === "QUERY_ANALYTICS") && /^Which\b/.test(body)) {
      if (this.state.stack.length < 3) this.push({ kind: "QUERY", action });
      this.state.lastQuestion = body.slice(0, 512);
    }
    return { type: action.type === "QUERY_HISTORY" || action.type === "QUERY_ANALYTICS" ? "HistoryFact" : "DomainResult", body };
  }
}
