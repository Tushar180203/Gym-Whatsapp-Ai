import { parseRecallIntent } from "./recall-intent.js";
import { localClock } from "../time/local-calendar.js";
import { attemptsPolicyBypass } from "./policy-boundary.js";
import { numericEvidence, hasExplicitUnit, explicitSetCounts } from "./numeric-evidence.js";
import type { IntentInterpreter } from "../../../ai/src/interfaces.js";
import { parseProposedActionEnvelope, type ProposedAction, type SetInput } from "../../../contracts/src/ai/actions.js";
import { type Us4Action, type ReplaceWorkoutAction } from "../parser/us4-parser.js";
import { isCoachingQuestion, parseHistoryQuestion } from "../messaging/history-query-parser.js";
import { parseStartIntent } from "../workouts/start-intent.js";
import { parseCompletionIntent } from "../workouts/completion-policy.js";
import { isResumeIntent } from "../workouts/resume-workout-command.js";
import { normalizeMessage, parseConversationGrammar, explicitScope, isScopeAnswer } from "./grammar.js";
import { resolveExerciseReference } from "./references.js";
import { planConversationResponse, formatWhatsAppPlan, formatSetFact, type DomainOutcome, type ConversationResponse } from "./responses.js";
import { conversationMode, type ConversationContext, type ConversationState, type PendingFrame } from "./state.js";

export type ConversationTrace = {
  conversationMode: ConversationState["mode"]; routeStage: string; pendingActionType?: string;
  resolvedIntent?: string; aiInvoked: boolean; aiActionType?: string; clarificationReason?: string;
  aiPromptVersion?: string;
  confirmationRequired: boolean; executionResult: string;
  deterministicMatch?: string; schemaValidated?: boolean; targetResolutionResult?: string; finalAction?: string; responseCategory?: string;
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
  outcome?(): DomainOutcome | undefined;
  observe?(trace: ConversationTrace): void;
}

// Rep-count replies such as "10, 10, 9 reps". Linear-time: separators and digits never compete
// for the same characters (the previous nested form backtracked exponentially on long digit runs).
export const REPS_LIST = /^\d+(?:[ ,]+\d+)*[ ,]*(?:(?<=[ ,])reps)?$/i;

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
    if (attemptsPolicyBypass(text)) {
      if (eventAt !== undefined) this.state.lastEventAt = eventAt;
      this.trace.routeStage = "POLICY_BOUNDARY"; this.trace.executionResult = "POLICY_BOUNDARY";
      return this.finish({ type: "SystemError", body: "I can help with your own recorded workout, but changes still need the usual checks and confirmation." });
    }
    let grammar = parseConversationGrammar(text);
    let semanticNeeded = false;
    // Existing high-confidence typed parses remain fast paths. Unrecognized
    // domain language falls through to Gemini before recovery; unknown or
    // ambiguous targets also use Gemini for interpretation, then resolve here.
    if (this.ports.interpreter && grammar?.kind === "ACTION" && (
      ["CHANGE_ACTIVE_EXERCISE", "REORDER_EXERCISE", "SKIP_EXERCISE"].includes(grammar.action.type) ||
      (grammar.action.type === "CONTINUE" && !isResumeIntent(text)) ||
      (grammar.action.type === "FINISH_WORKOUT" && !parseCompletionIntent(text))
    )) {
      grammar = undefined;
      semanticNeeded = true;
    }
    if (grammar?.kind === "ACTION" && (grammar.action.type === "CHANGE_ACTIVE_EXERCISE" || grammar.action.type === "LOG_CONTEXT_SETS") && this.ports.interpreter) {
      const resolved = resolveExerciseReference(grammar.action.exerciseRef, this.context.exercises, this.context.workout?.activeExerciseId ?? null);
      if (resolved.status === "UNKNOWN" || this.state.stack.at(-1)?.kind === "REPLACE") { grammar = undefined; semanticNeeded = true; }
    }
    if (grammar?.kind === "REPLACE" && grammar.replacement && this.ports.interpreter) {
      const replacement = grammar.replacement.toLowerCase();
      const names = this.context.identities.flatMap(e => [e.name, ...e.aliases]).map(n => n.toLowerCase());
      // A known identity followed by more language is not a new literal exercise name.
      if (!names.includes(replacement) && names.some(name => replacement.startsWith(`${name} `))) { grammar = undefined; semanticNeeded = true; }
    }
    if (grammar) this.trace.deterministicMatch = grammar.kind;
    const recall = parseRecallIntent(text, new Date(this.ports.now()), this.context.timeZone ?? "UTC");
    const hadPending = this.state.stack.length > 0;
    const expired = hadPending && this.state.expiresAt !== null && this.state.expiresAt <= this.ports.now();
    const stale = hadPending && (this.state.workoutId !== (this.context.workout?.id ?? null) || this.state.workoutVersion !== (this.context.workout?.version ?? null));
    if (expired || stale) {
      if (this.state.stack.some(f => f.kind === "CUSTOM" && f.confirmationId === this.context.confirmation?.id)) await this.ports.cancel();
      this.clear();
      if (!recall && ((!grammar && !parseStartIntent(text) && !parseCompletionIntent(text) && !isResumeIntent(text) && !parseHistoryQuestion(text)) || /^(yes|confirm|no|today|permanent(?:ly)?|first|second|\d+)$/i.test(text))) return this.finish({ type: expired ? "Expired" : "Stale" });
    }
    if (eventAt !== undefined) this.state.lastEventAt = eventAt;

    if (recall) return this.finish(await this.action(recall, text));

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
    const factualQuestion = parseHistoryQuestion(text);
    if (factualQuestion) { this.trace.routeStage = "FACT"; return this.finish(await this.action(factualQuestion, text)); }
    if (isCoachingQuestion(text)) {
      this.trace.routeStage = "FACT";
      const body = await this.ports.deterministic(text);
      if (body !== undefined) return this.finish({ type: "CoachingBoundary", body });
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
    if (parseCompletionIntent(text) || isResumeIntent(text)) {
      if (!this.context.workout) return this.finish(this.recovery());
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
    if (grammar?.kind === "NAVIGATE") {
      this.trace.routeStage = "SESSION_CHANGE";
      return this.finish(await this.action({ type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: grammar.exerciseRef }, text));
    }
    if (grammar?.kind === "EXTRA_SET") {
      this.trace.routeStage = "SET";
      return this.finish(await this.prepareSet(grammar.exerciseRef ?? "current", text));
    }
    if (grammar?.kind === "LOG" || grammar?.kind === "LOG_NEXT") {
      this.trace.routeStage = "SET";
      this.trace.resolvedIntent = grammar.kind;
      const body = await this.ports.log(grammar.notation, grammar.kind === "LOG_NEXT");
      return this.finish({ type: "SetLogged", body, ...(grammar.kind === "LOG_NEXT" ? {} : this.activeName()) });
    }
    if (grammar?.kind === "LOAD_ONLY") return this.finish(await this.semantic({ type: "DRAFT_SETS", loadValue: grammar.load, weightUnit: grammar.unit, count: 1 }, text) ?? this.recovery());
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
    const deterministic = semanticNeeded || this.state.stack.length ? undefined : await this.ports.deterministic(text);
    if (deterministic !== undefined) return this.finish(/^No pending scope question/.test(deterministic) ? { type: "Expired" } : { type: "DomainResult", body: deterministic });
    if (!this.ports.interpreter) return this.finish(this.recovery());
    this.trace.routeStage = "AI"; this.trace.aiInvoked = true;
    if (this.ports.interpreter.promptVersion) this.trace.aiPromptVersion = this.ports.interpreter.promptVersion;
    const parent = this.state.stack.find(f => f.kind === "REPLACE");
    let envelope;
    try {
      this.ports.beforeAi?.();
      envelope = parseProposedActionEnvelope(await this.ports.interpreter.interpret({ userInput: text, idempotencyKey: this.ports.key, context: {
        clock: localClock(new Date(this.ports.now()), this.context.timeZone ?? "UTC"),
        recentConversation: this.context.recentConversation ?? [],
        userId: this.ports.userId, activeWorkout: this.state.mode === "WORKOUT_ACTIVE" || this.state.mode === "WORKOUT_FINISH_PENDING",
        ...(this.activeName().exerciseName ? { activeExercise: this.activeName().exerciseName } : {}),
        ...(this.context.workout?.activeExerciseId ? (() => {
          const exercise = this.context.exercises.find(e => e.id === this.context.workout?.activeExerciseId);
          const completed = this.context.sets
            .filter(set => set.exerciseId === this.context.workout?.activeExerciseId)
            .map(set => ({ ordinal: set.index, loadValue: set.load, weightUnit: set.unit, reps: set.reps }));
          return {
            ...(exercise ? { activeExerciseContext: {
              name: exercise.name,
              ...(exercise.plannedSets !== undefined ? { plannedSets: exercise.plannedSets } : {}),
              ...(exercise.repsMin !== undefined ? { repsMin: exercise.repsMin } : {}),
              ...(exercise.repsMax !== undefined ? { repsMax: exercise.repsMax } : {}),
              ...(exercise.loadSemantics !== undefined ? { loadSemantics: exercise.loadSemantics } : {})
            } } : {}),
            completedSetsForActiveExercise: completed.slice(-20)
          };
        })() : {}),
        knownExerciseRefs: this.context.identities.slice(0, 100).map(e => e.name),
        confirmedAliases: this.context.identities.flatMap(e => e.aliases.map(alias => ({ alias, exerciseRef: e.name }))).slice(0, 100),
        ...(this.context.sets.filter(set => set.exerciseId === this.context.workout?.activeExerciseId).at(-1) ? { previousSet: (() => { const set = this.context.sets.filter(set => set.exerciseId === this.context.workout?.activeExerciseId).at(-1)!; return { loadValue: set.load, reps: set.reps, weightUnit: set.unit, loadSemantics: set.semantics }; })() } : {}),
        activeLoadSemantics: this.context.exercises.find(e => e.id === this.context.workout?.activeExerciseId)?.loadSemantics ?? "UNSPECIFIED_DEFAULT",
        ...(this.context.preferredWeightUnit ? { preferredWeightUnit: this.context.preferredWeightUnit } : {}),
        pendingQuestion: this.context.workout?.finishPending
          ? "Save completed, save incomplete, continue, or discard?"
          : this.state.lastQuestion,
        ...(this.context.workout ? { workoutContext: { name: this.context.workout.name, status: this.context.workout.status, exercises: this.context.exercises.slice(0, 50).map(({ name, plannedSets, repsMin, repsMax, loadSemantics }) => ({ name, ...(plannedSets !== undefined ? { plannedSets } : {}), ...(repsMin !== undefined ? { repsMin } : {}), ...(repsMax !== undefined ? { repsMax } : {}), ...(loadSemantics?{loadSemantics}:{}) })) } } : {}),
        ...((()=>{ const frame = this.state.stack.at(-1); return frame?.kind === "ALIAS" ? { pendingProposal: { type: "MAP_EXERCISE_ALIAS" as const, alias: frame.alias, exerciseRef: frame.exerciseRef ?? "unresolved" } } : frame && (frame.kind === "SCOPE" || frame.kind === "QUERY" || frame.kind === "TARGET") ? { pendingProposal: frame.action as ProposedAction } : {}; })()),
        ...(this.state.stack.at(-1)?.kind === "SET_DRAFT" ? { partialSetDraft: (() => { const draft = this.state.stack.at(-1)!; if (draft.kind !== "SET_DRAFT") throw new Error("Draft changed"); return { loadValue: draft.load, count: draft.count, ...(draft.unit ? { weightUnit: draft.unit } : {}) }; })() } : {}),
        ...(this.state.recentExerciseId ? { recentReferencedExercise: this.context.exercises.find(e => e.id === this.state.recentExerciseId)?.name ?? "" } : {}),
        ...(this.context.sets.at(-1) ? { recentReferencedSet: (() => { const set = this.context.sets.at(-1)!; return { exercise: this.context.exercises.find(e => e.id === set.exerciseId)?.name ?? "", index: set.index, loadValue: set.load, reps: set.reps }; })() } : {}),
        conversationMode: this.state.mode, pendingAction: this.context.workout?.finishPending ? "FINISH_CHOICE" : this.state.stack.at(-1)?.kind ?? null,
        ...(parent?.kind === "REPLACE" ? { pendingOperation: { type: "REPLACE_EXERCISE" as const,
          sourceExercise: this.context.exercises.find(e => e.id === parent.source)?.name ?? parent.source,
          replacementExercise: this.context.identities.find(e => e.id === parent.replacement)?.name ?? parent.replacement,
          scope: parent.scope, awaiting: parent.slot } } : {}),
        allowedActionTypes: ["GREETING", "HELP", "REPEAT", "CONTINUE", "CANCEL_PENDING_OPERATION", "QUERY_PLAN", "QUERY_CURRENT_STATE", "COACHING_BOUNDARY", "ANSWER_PENDING_QUESTION", "DRAFT_SETS", "PREPARE_SET", "NEXT_EXERCISE", "PREVIOUS_EXERCISE", "REORDER_EXERCISE", "START_WORKOUT", "RESUME_WORKOUT", "CORRECT_SET", "DELETE_SET", "CHANGE_ACTIVE_EXERCISE", "REPLACE_EXERCISE", "ADD_EXERCISE", "SKIP_EXERCISE", "CHANGE_SESSION", "CREATE_CUSTOM_EXERCISE", "MAP_EXERCISE_ALIAS", "UPDATE_ROUTINE_REQUEST", "QUERY_HISTORY", "QUERY_ANALYTICS", "QUERY_CONVERSATION", "FINISH_WORKOUT", "UNKNOWN", ...(["WORKOUT_ACTIVE", "WORKOUT_FINISH_PENDING"].includes(this.state.mode) ? ["LOG_SET", "LOG_MULTIPLE_SETS"] : [])]
      } }));
    } catch { this.trace.schemaValidated = false; this.trace.executionResult = "AI_FAILED"; return this.finish({ type: "ProviderError", context: this.context, state: this.state }); }
    this.trace.schemaValidated = true;
    this.trace.aiActionType = envelope.action.type;
    if (envelope.requestKind === "POLICY_BYPASS_ATTEMPT" || envelope.requestKind === "META_INSTRUCTION") {
      this.trace.executionResult = "POLICY_BOUNDARY";
      return this.finish({ type: "SystemError", body: "I can help with your own recorded workout, but changes still need the usual checks and confirmation." });
    }
    if (envelope.action.type === "DRAFT_SETS" && envelope.confidence !== "low") return this.finish(await this.semantic(envelope.action, text) ?? this.recovery());
    if (envelope.action.type === "PREPARE_SET" && envelope.confidence !== "low") return this.finish(await this.prepareSet(envelope.action.exerciseRef ?? "current", text));
    // Resolving an alias target locally only prepares a protected confirmation;
    // uncertainty must not discard a complete parent and leave the user stuck.
    if(envelope.action.type==="MAP_EXERCISE_ALIAS"&&envelope.confidence!=="low")return this.finish(await this.action(envelope.action,text));
    if (envelope.confidence === "low" || envelope.requiresClarification) {
      // Recover supported parent intent without trusting low-confidence targets or numeric fields.
      this.trace.clarificationReason = "AI_AMBIGUITY";
      if (envelope.action.type === "QUERY_HISTORY" || envelope.action.type === "QUERY_ANALYTICS") {
        if (this.state.stack.length < 3) this.push({ kind: "QUERY", action: envelope.action });
        return this.finish(this.question("Which exact exercise, workout session or muscle do you mean?", "AI_AMBIGUITY"));
      }
      if (!this.state.stack.length && envelope.action.type === "REPLACE_EXERCISE") {
        this.push({ kind: "REPLACE", source: null, replacement: null, scope: "AMBIGUOUS", slot: "SOURCE" });
        return this.finish(this.question("Which exercise in this workout should I replace?", "AI_AMBIGUITY"));
      }
      return this.finish(this.recovery());
    }
    const semantic = await this.semantic(envelope.action, text);
    if (semantic) return this.finish(semantic);
    if (envelope.action.type === "UNKNOWN") return this.finish(this.recovery());
    if ((envelope.action.type === "LOG_SET" || envelope.action.type === "LOG_MULTIPLE_SETS") && /^(?:actually|sorry|correct|fix|change|i meant)\b/i.test(text)) return this.finish(this.question("Which set should I correct, and what are the correct load and reps?", "CORRECTION_NOT_NEW_SET"));
    return this.finish(await this.action(envelope.action, text));
  }

  private applied(body: string): boolean { return this.ports.outcome ? this.ports.outcome()?.effect === "APPLIED" : /^(Logged)|applied\./.test(body); }
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
    const outcome = this.ports.outcome?.();
    if (this.trace.executionResult === "REPLIED" && response.type === "Clarification") this.trace.executionResult = "CLARIFIED";
    if (outcome && this.trace.executionResult === "REPLIED") this.trace.executionResult = outcome.effect;
    if (!outcome && this.trace.executionResult === "REPLIED") {
      if (["HistoryFact", "AnalyticsFact", "CurrentState", "Plan", "Greeting", "Help", "CoachingBoundary"].includes(response.type)) this.trace.executionResult = "READ_ONLY";
      else if (response.type === "Clarification") this.trace.executionResult = "CLARIFIED";
      else if (response.type === "Confirmation") this.trace.executionResult = "CONFIRMATION_REQUIRED";
    }
    if (persist) {
      const refreshed = await this.ports.refresh();
      this.state.mode = conversationMode(refreshed);
      const parent = this.state.stack.at(-1);
      if (response.type === "SetLogged" && this.applied(response.body) && this.state.stack.length === 1 && parent?.kind === "REPLACE" && !refreshed.confirmation && refreshed.workout?.id === this.state.workoutId && refreshed.exercises.some(e => e.id === parent.source)) this.state.workoutVersion = refreshed.workout.version;
      if (!this.state.stack.length) { this.state.workoutId = refreshed.workout?.id ?? null; this.state.workoutVersion = refreshed.workout?.version ?? null; }
      const active = refreshed.workout?.activeExerciseId;
      if (active && active !== this.context.workout?.activeExerciseId) this.state.recentExerciseId = this.context.workout?.activeExerciseId ?? active;
      const last = refreshed.sets.at(-1); this.state.recentSetId = last?.id ?? null;
      this.state.version++; await this.ports.save(this.state);
      this.trace.confirmationRequired = Boolean(refreshed.confirmation);
    }
    const pendingKind = this.state.stack.at(-1)?.kind;
    if (pendingKind) this.trace.pendingActionType = pendingKind;
    const plan = planConversationResponse(response, outcome);
    this.trace.responseCategory = plan.category;
    const finalAction = this.trace.resolvedIntent ?? this.trace.aiActionType;
    if (finalAction) this.trace.finalAction = finalAction;
    this.ports.observe?.(this.trace);
    return formatWhatsAppPlan(plan);
  }
  private async fact(query: "PLAN" | "CURRENT" | "NEXT" | "LAST_SET" | "SETS"): Promise<ConversationResponse> {
    if (query === "PLAN") return { type: "Plan", body: await this.ports.plan() };
    const exercise = this.context.exercises.find(e => e.id === this.context.workout?.activeExerciseId);
    if (query === "CURRENT") return { type: "CurrentState", body: exercise ? `${this.context.workout!.name}: You're on ${exercise.name}.${exercise.plannedSets == null ? "" : ` ${exercise.plannedSets} sets${exercise.repsMin == null ? "" : ` × ${exercise.repsMin}${exercise.repsMax != null && exercise.repsMax !== exercise.repsMin ? `–${exercise.repsMax}` : ""}`}.`}
${exercise.recordedSets ?? this.context.sets.filter(s => s.exerciseId === exercise.id).length} sets logged.` : "No exercise is active. Send START to train." };
    if (query === "NEXT") {
      const r = resolveExerciseReference("next", this.context.exercises, exercise?.id ?? null);
      return { type: "CurrentState", body: r.status === "RESOLVED" ? `Next: ${r.exercise.name}.` : "No next planned exercise. You can choose an exercise or finish." };
    }
    if (query === "LAST_SET") {
      const last = this.context.sets.at(-1);
      return { type: "HistoryFact", body: last ? `Last set: ${formatSetFact(last)}.` : "No recorded set in this workout." };
    }
    const count = exercise?.recordedSets ?? this.context.sets.filter(s => s.exerciseId === exercise?.id).length;
    return { type: "CurrentState", body: exercise ? `${exercise.name}: ${count} recorded sets; ${exercise.plannedSets === null || exercise.plannedSets === undefined ? "no planned count" : `${Math.max(0, exercise.plannedSets - count)} planned sets remaining`}.` : "No exercise is active." };
  }

  private async answerPending(text: string, freeAnswer: boolean): Promise<ConversationResponse | undefined> {
    const frame = this.state.stack.at(-1);
    if (!frame) return undefined;
    if (frame.kind === "ALIAS" && frame.slot === "TARGET" && freeAnswer && text.length <= 120 && this.context.identities.some(e => [e.id, e.name, ...e.aliases].some(n => n.toLowerCase() === text.toLowerCase()))) {
      if (frame.slot === "TARGET") frame.exerciseRef = text; else frame.alias = text;
      return this.continueAlias(frame);
    }
    if (frame.kind === "REPAIR_EXERCISE" && freeAnswer) {
      if (/^(?:switch|active|current exercise)$/i.test(text)) { this.clear(); return this.action({ type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: frame.exerciseRef }, text); }
      if (/^(?:set|recorded set|last set)$/i.test(text)) return this.question("I won't move a recorded set between exercises from an uncertain reference. Specify corrected load/reps, or delete and relog the set under the right exercise.", "EXERCISE_REPAIR_POLICY");
    }
    const shortReference = this.context.identities.some(e => [e.name, ...e.aliases].some(name => name.toLowerCase() === text.toLowerCase())) || this.context.choices.some(c => c.name.toLowerCase() === text.toLowerCase()) || text.toLowerCase() === this.context.workout?.name.toLowerCase() || /^(?:chest|back|shoulders|legs|quads|hamstrings|glutes|calves|biceps|triceps|abs)$/i.test(text);
    if (frame.kind === "QUERY" && shortReference && freeAnswer && !/\b(?:show|what|how|when|start|done|actually|replace|add|delete)\b/i.test(text) && text.length <= 120) {
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
    if (frame.kind === "CUSTOM") return undefined;
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
      if ((frame.slot === "REPLACEMENT" || frame.slot === "SOURCE") && freeAnswer && !/\b(?:show|what|how|when|start|done|actually)\b/i.test(text) && text.length <= 120 && this.context.identities.some(e => e.name.toLowerCase() === text.toLowerCase() || e.aliases.some(a => a.toLowerCase() === text.toLowerCase()))) {
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
        if (change.operation === "REORDER_EXERCISE") return this.action({ type: "REORDER_EXERCISE", exerciseRef: change.exerciseRef, ordinal: change.newOrderRef === "first" ? 1 : Number(change.newOrderRef) }, text);
        return this.question("Specify the session-only exercise change.", "UNSUPPORTED_SESSION_CHANGE");
      }
      return this.action({ ...frame.action, scope } as ProposedAction, text);
    } else if (frame.kind === "SET_DRAFT" && REPS_LIST.test(text)) {
      const reps = numericEvidence(text);
      if (reps.length !== frame.count || reps.some(n => !Number.isInteger(n) || n < 1)) return this.question(`Send ${frame.count} positive rep count${frame.count === 1 ? "" : "s"}, one for each set.`, "INCOMPLETE_REPS");
      if (frame.exerciseId !== this.context.workout?.activeExerciseId) return this.question("The active exercise changed. Send the load and reps for this exercise.", "STALE_DRAFT");
      const body = await this.ports.log(reps.map(n => `${frame.load} ${frame.unit ?? ""} x ${n}`).join(", "));
      if (this.applied(body)) this.clear();
      return { type: "SetLogged", body, ...this.activeName() };
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
      return undefined;
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

  private async continueAlias(frame: Extract<PendingFrame, { kind: "ALIAS" }>): Promise<ConversationResponse> {
    let targets = frame.exerciseRef ? await this.ports.resolveIdentity?.(frame.exerciseRef) ?? this.context.identities.filter(e => e.id === frame.exerciseRef || [e.name, ...e.aliases].some(n => n.toLowerCase() === frame.exerciseRef!.toLowerCase())) : [];
    if (!targets.length && frame.exerciseRef) {
      const resolution = resolveExerciseReference(frame.exerciseRef, this.context.exercises, this.context.workout?.activeExerciseId ?? null);
      if (resolution.status === "RESOLVED") targets = [{ id: resolution.exercise.identityId, name: resolution.exercise.name, aliases: [] }];
    }
    if (targets.length !== 1) { frame.slot = "TARGET"; return this.question(`Which saved exercise should I call ${frame.alias}?`, "ALIAS_TARGET_REQUIRED"); }
    frame.exerciseRef = targets[0]!.id;
    const conflicts = await this.ports.resolveIdentity?.(frame.alias) ?? this.context.identities.filter(e => [e.name, ...e.aliases].some(n => n.toLowerCase() === frame.alias.toLowerCase()));
    if (conflicts.some(e => e.id !== frame.exerciseRef)) { frame.slot = "NAME"; return this.question("That name already belongs to another exercise. What other name would you like to use?", "ALIAS_NAME_CONFLICT"); }
    this.state.stack.pop(); if (!this.state.stack.length) this.state.expiresAt = null; this.state.lastQuestion = null;
    const body = await this.ports.execute({ type: "MAP_EXERCISE_ALIAS", alias: frame.alias, exerciseRef: frame.exerciseRef }, `call ${targets[0]!.name} ${frame.alias}`);
    return { type: "Confirmation", body };
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
    if (frame.scope === "SESSION_ONLY" && this.applied(body) && changed.workout?.templateId) this.state.recentChange = {
      action: { type: "UPDATE_ROUTINE_REQUEST", scope: "PERMANENT_ROUTINE", requestedChange: { operation: "REPLACE_EXERCISE", sessionRef: changed.workout.templateId, fromExerciseRef: source.exercise.identityId, toExerciseRef: replacement[0]!.id } },
      workoutId: changed.workout.id, workoutVersion: changed.workout.version, expiresAt: this.ports.now() + 600_000
    };
    return { type: "DomainResult", body };
  }

  private async prepareSet(reference: string, input: string): Promise<ConversationResponse> {
    if (this.context.workout?.status !== "ACTIVE") return this.recovery();
    const target = resolveExerciseReference(reference, this.context.exercises, this.context.workout.activeExerciseId, this.state.recentExerciseId);
    if (target.status !== "RESOLVED") return this.action({ type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: reference }, input);
    if (target.exercise.id !== this.context.workout.activeExerciseId) {
      const changed = await this.action({ type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: target.exercise.id }, input);
      const refreshed = await this.ports.refresh();
      if (refreshed.workout?.activeExerciseId !== target.exercise.id) return changed;
    }
    return this.question(`You can log another set for ${target.exercise.name}, even beyond the planned sets. Send the load and completed reps, such as 30x4. No additional set has been recorded yet.`, "MISSING_SET_VALUES");
  }

  private async semantic(action: Us4Action, input: string): Promise<ConversationResponse | undefined> {
    if (action.type === "PREPARE_SET") return this.prepareSet(action.exerciseRef ?? "current", input);
    if (action.type === "PREVIOUS_EXERCISE") {
      const index = this.context.exercises.findIndex(e => e.id === this.context.workout?.activeExerciseId);
      const previous = index > 0 ? this.context.exercises[index - 1] : undefined;
      if (!previous) return this.question("You're at the first exercise. Which exercise would you like to do?", "NO_PREVIOUS_EXERCISE");
      return this.action({ type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: previous.id }, input);
    }
    if (action.type === "REORDER_EXERCISE" && explicitScope(input) === "PERMANENT_ROUTINE") {
      if (!this.context.workout?.templateId) return this.question("Which saved workout should I update?", "MISSING_ROUTINE_TARGET");
      return this.action({ type: "UPDATE_ROUTINE_REQUEST", scope: "PERMANENT_ROUTINE", requestedChange: { operation: "REORDER_EXERCISE", exerciseRef: action.exerciseRef, sessionRef: this.context.workout.templateId, newOrderRef: String(action.ordinal) } }, input);
    }
    if (action.type === "QUERY_PLAN") return this.fact("PLAN");
    if (action.type === "CONTINUE" && (this.context.workout?.finishPending || this.context.workout?.status === "PAUSED")) return { type: "DomainResult", body: await this.ports.execute({ type: "RESUME_WORKOUT" }, input) };
    if (action.type === "QUERY_CURRENT_STATE" || action.type === "CONTINUE") return this.fact("CURRENT");
    if (action.type === "GREETING" || action.type === "HELP" || action.type === "REPEAT") return { type: action.type === "GREETING" ? "Greeting" : "Help", context: this.context, state: this.state };
    if (action.type === "COACHING_BOUNDARY") return { type: "CoachingBoundary", body: "I can show your saved plan and recorded performance, but I can't recommend weights or training changes." };
    if (action.type === "CANCEL_PENDING_OPERATION") { await this.ports.cancel(); this.clear(); return { type: "Cancelled" }; }
    if (action.type === "ANSWER_PENDING_QUESTION") {
      const frame = this.state.stack.at(-1);
      if (!frame || frame.kind === "CUSTOM" || this.context.confirmation) return this.recovery();
      if (frame.kind === "ALIAS") {
        if (frame.slot === "TARGET") frame.exerciseRef = action.answer; else frame.alias = action.answer;
        return this.continueAlias(frame);
      }
      if (frame.kind === "REPLACE") {
        if (frame.slot === "SCOPE") {
          const scope = action.answer === "SESSION_ONLY" || action.answer === "PERMANENT_ROUTINE" ? action.answer : explicitScope(action.answer);
          if (scope === "AMBIGUOUS") return this.recovery();
          // Permanent scope still passes the existing protected confirmation policy.
          frame.scope = scope; return this.continueReplacement();
        }
        if (frame.slot === "SOURCE") frame.source = action.answer; else frame.replacement = action.answer;
        return this.continueReplacement();
      }
      if (frame.kind === "SCOPE" && ["SESSION_ONLY", "PERMANENT_ROUTINE"].includes(action.answer)) return await this.answerPending(action.answer === "SESSION_ONLY" ? "today" : "update my routine", true) ?? this.recovery();
      if (frame.kind === "SET_DRAFT" || frame.kind === "LOAD" || frame.kind === "SAME_REPS") {
        const proposed = numericEvidence(action.answer), supplied = numericEvidence(input);
        if (proposed.length !== (frame.kind === "SET_DRAFT" ? frame.count : 1) || !proposed.every(n => supplied.includes(n))) return this.recovery();
      }
      return await this.answerPending(action.answer, true) ?? this.recovery();
    }
    if (action.type === "DRAFT_SETS") {
      const supplied = numericEvidence(input);
      const counts = explicitSetCounts(input);
      if (this.context.workout?.status !== "ACTIVE" || !this.context.workout.activeExerciseId || !supplied.includes(action.loadValue) || (counts.length > 0 && (counts.length !== 1 || counts[0] !== action.count)) || (action.count > 1 && counts.length !== 1) || (action.weightUnit && !hasExplicitUnit(input, action.weightUnit) && (hasExplicitUnit(input, "KG") || hasExplicitUnit(input, "LB") || action.weightUnit !== this.context.preferredWeightUnit))) return this.recovery();
      this.push({ kind: "SET_DRAFT", load: action.loadValue, count: action.count, exerciseId: this.context.workout.activeExerciseId, ...(action.weightUnit ? { unit: action.weightUnit } : {}) });
      return this.question(action.count === 1 ? "How many reps?" : "How many reps in each set? Send one count for each set, such as 7 7 6.", "MISSING_REPS");
    }
    return undefined;
  }

  private async action(action: Us4Action, input: string): Promise<ConversationResponse> {
    this.trace.resolvedIntent = action.type;
    if (!this.context.workout && ["FINISH_WORKOUT", "RESUME_WORKOUT", "NEXT_EXERCISE", "PREVIOUS_EXERCISE", "LOG_SET", "LOG_MULTIPLE_SETS"].includes(action.type)) return this.recovery();
    const semantic = await this.semantic(action, input);
    if (semantic) return semantic;
    if (action.type === "MAP_EXERCISE_ALIAS") {
      const pending = this.state.stack.at(-1);
      if (pending?.kind === "ALIAS") {
        if (pending.slot === "NAME") pending.alias = action.alias; else pending.exerciseRef = action.exerciseRef;
        return this.continueAlias(pending);
      }
      const frame: Extract<PendingFrame, { kind: "ALIAS" }> = { kind: "ALIAS", alias: action.alias, exerciseRef: action.exerciseRef, slot: "TARGET" };
      this.push(frame); return this.continueAlias(frame);
    }
    if (action.type === "CORRECT_SET") {
      const supplied = numericEvidence(input);
      if ([action.replacement.reps, action.replacement.loadValue].some(value => value !== undefined && !supplied.includes(value))
        || (action.replacement.weightUnit && !hasExplicitUnit(input, action.replacement.weightUnit))
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
      this.trace.targetResolutionResult = resolution.status;
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
      return this.question(body, "QUERY_SUBJECT_REQUIRED");
    }
    if (action.type === "LOG_SET" || action.type === "LOG_MULTIPLE_SETS") {
      const refreshed=await this.ports.refresh();
      const exerciseName=refreshed.exercises.find(e=>e.id===refreshed.workout?.activeExerciseId)?.name;
      return { type: "SetLogged", body, ...(exerciseName?{exerciseName}:{}) };
    }
    return { type: action.type === "QUERY_HISTORY" || action.type === "QUERY_CONVERSATION" ? "HistoryFact" : action.type === "QUERY_ANALYTICS" ? "AnalyticsFact" : "DomainResult", body };
  }
}
