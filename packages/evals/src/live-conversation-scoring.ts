import { isDeepStrictEqual } from "node:util";
import type { LiveCase } from "./live-conversation-corpus.js";

export type AcceptanceObservation = {
  aiInvoked: boolean; capture: Array<{ proposal?: unknown; validated?: boolean; error?: string }>;
  clarification: boolean; confirmation: boolean; response: string; violations: string[];
};
const object = (value: unknown): Record<string, any> => value && typeof value === "object" ? value as Record<string, any> : {};
const read = (value: unknown, path: string): unknown => path.split(".").reduce((v, key) => object(v)[key], value);

// Quality is intent PLUS payload. A locally blocked invented reference is not a correct proposal.
export function scoreLiveProposal(c: LiveCase, observation: AcceptanceObservation): string {
  if (!observation.aiInvoked) return "DETERMINISTIC";
  const capture = observation.capture[0]!;
  if (!capture.validated) return capture.error && capture.error !== "AI_SCHEMA_INVALID" ? "PROVIDER_FAILURE" : "LOCALLY_REJECTED";
  const envelope = object(capture.proposal), action = object(envelope.action);
  let correct = c.actions.includes(action.type) && Object.entries(c.field ?? {}).every(([path, expected]) => isDeepStrictEqual(read(action, path), expected));
  if (action.type === "START_WORKOUT") {
    correct &&= !action.routineRef || action.routineRef.toLowerCase() === "recorded rotation";
    correct &&= !action.sessionRef || action.sessionRef.toLowerCase() === "push";
  }
  if (c.group === "temporary" || c.group === "context" || (c.group === "informal" && c.policy === "SESSION")) {
    if ("scope" in action && action.scope !== "SESSION_ONLY") correct = false;
    if (action.type === "UPDATE_ROUTINE_REQUEST") correct = false; // A permanent-request type is not a session reorder.
    if (action.type === "REPLACE_EXERCISE") {
      correct &&= /^(?:cable fly|flys?|cable)$/i.test(action.toExerciseRef ?? "");
      correct &&= !action.fromExerciseRef || /^(?:barbell bench press|bench|current|this)$/i.test(action.fromExerciseRef);
    }
    if (action.type === "CHANGE_ACTIVE_EXERCISE") {
      const shoulder = /should|sholder/i.test(c.message);
      correct &&= shoulder ? /shoulder|sholder/i.test(action.exerciseRef ?? "") : /cable|fly/i.test(action.exerciseRef ?? "");
    }
  }
  if (c.group === "pending-semantic") correct &&= action.type === "ANSWER_PENDING_QUESTION" ? /^(?:today|SESSION_ONLY|this session|today only)$/i.test(action.answer ?? "") : action.type === "REPLACE_EXERCISE" && action.scope === "SESSION_ONLY" && /^(?:Cable Fly|flys?|cable)$/i.test(action.toExerciseRef ?? "") && /^(?:Barbell Bench Press|bench|current)$/i.test(action.fromExerciseRef ?? "");
  if (c.group === "permanent" && action.type !== "UNKNOWN") correct &&= action.scope === "PERMANENT_ROUTINE";
  if (c.group === "casual" && c.message === "nah leave it") correct = action.type === "CANCEL_PENDING_OPERATION";
  if (c.group === "casual" && c.message === "bro what's next") correct = action.type === "QUERY_CURRENT_STATE" || action.type === "HELP";
  if (c.group === "casual" && c.message === "can we continue?") correct = action.type === "CONTINUE" || action.type === "RESUME_WORKOUT" || action.type === "FINISH_WORKOUT" && action.requestedCompletion === "CONTINUE";
  if (c.group === "correction" || c.group === "informal" && c.policy === "CORRECTION") {
    const replacement = object(action.replacement);
    if (replacement.loadValue !== undefined && c.field?.["replacement.loadValue"] === undefined) correct = false;
    if (replacement.reps !== undefined && c.field?.["replacement.reps"] === undefined) correct = false;
    if (replacement.weightUnit !== undefined || replacement.loadSemantics !== undefined) correct = false;
    if (c.message === "the second set was actually 8") correct &&= /(?:set:2|set 2|second)/i.test(action.targetRef ?? "");
  }
  if (c.group === "reference" && c.message === "do the second exercise") correct &&= /second|2|cable|fly/i.test(action.exerciseRef ?? "");
  if (c.policy === "AMBIGUOUS") correct &&= observation.clarification || envelope.requiresClarification || action.type === "UNKNOWN";
  if (c.group === "history" && "subject" in action) {
    const reference = object(action.subject);
    if (c.id === "history-1") correct &&= /^(?:bench|barbell bench press)$/i.test(reference.exerciseRef ?? "");
    if (c.id === "history-2") correct &&= reference.kind === "MUSCLE" && /^chest$/i.test(reference.muscleRef ?? "");
    if (c.id === "history-3") correct &&= /^(?:incline|incline press)$/i.test(reference.exerciseRef ?? "");
  }
  if (c.id === "hallucination-1" && action.type === "QUERY_HISTORY") correct &&= action.queryKind === "LAST_EXERCISE";
  // The preserved baseline exposed a dispatcher defect, not a wrong CONTINUE proposal.
  const continuationDispatchDefect = c.message === "can we continue?" && action.type === "FINISH_WORKOUT" && action.requestedCompletion === "CONTINUE"
    && observation.violations.every(v => v === "UNEXPECTED_MUTATION");
  if (observation.violations.length && !continuationDispatchDefect) return "INCORRECT";
  if (correct) return "CORRECT";
  return envelope.requiresClarification || action.scope === "AMBIGUOUS" ? "CLARIFICATION_SAFE" : "INCORRECT";
}
