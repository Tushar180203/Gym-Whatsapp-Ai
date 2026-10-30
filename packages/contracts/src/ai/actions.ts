import type { LoadSemantics, WeightUnit } from "../domain/enums.js";
import { z } from "zod";

export const workoutActionSchemaVersion = "workout-action.v1" as const;

export type AiConfidence = "low" | "medium" | "high";
export type ChangeScope = "SESSION_ONLY" | "PERMANENT_ROUTINE" | "AMBIGUOUS";

export type SetInput = {
  exerciseRef?: string;
  loadValue?: number;
  weightUnit?: WeightUnit;
  loadSemantics?: LoadSemantics;
  reps?: number;
  note?: string;
  failedAttemptReps?: number;
  ordinalRef?: string;
};

export type SetLogInput = Omit<SetInput, "reps"> & {
  reps: number;
};

export type RoutineChange =
  | { operation: "ADD_EXERCISE"; sessionRef: string; exerciseRef: string; orderRef?: string }
  | { operation: "REMOVE_EXERCISE"; sessionRef: string; exerciseRef: string }
  | { operation: "REPLACE_EXERCISE"; sessionRef: string; fromExerciseRef: string; toExerciseRef: string }
  | { operation: "REORDER_EXERCISE"; sessionRef: string; exerciseRef: string; newOrderRef: string }
  | { operation: "ADD_SESSION"; routineRef?: string; sessionName: string; orderRef?: string }
  | { operation: "REMOVE_SESSION"; sessionRef: string }
  | { operation: "REPLACE_SESSION"; fromSessionRef: string; toSessionRef: string }
  | { operation: "REORDER_SESSION"; sessionRef: string; newOrderRef: string };

export type QuerySubject =
  | { kind: "EXERCISE"; exerciseRef: string }
  | { kind: "MUSCLE"; muscleRef: string }
  | { kind: "WORKOUT_SESSION"; workoutRef: string }
  | { kind: "ROUTINE_SESSION"; sessionRef: string }
  | { kind: "ROUTINE"; routineRef: string };

export type ConversationSemanticAction =
  | { type: "GREETING" | "HELP" | "REPEAT" | "CANCEL_PENDING_OPERATION" | "CONTINUE" | "QUERY_PLAN" | "QUERY_CURRENT_STATE" | "COACHING_BOUNDARY" }
  | { type: "ANSWER_PENDING_QUESTION"; answer: string }
  | { type: "PREPARE_SET"; exerciseRef?: string }
  | { type: "DRAFT_SETS"; loadValue: number; weightUnit?: WeightUnit; count: number };

export type ProposedAction =
  | ConversationSemanticAction
  | { type: "START_WORKOUT"; routineRef?: string; sessionRef?: string }
  | { type: "RESUME_WORKOUT"; workoutRef?: string }
  | { type: "NEXT_EXERCISE" | "PREVIOUS_EXERCISE" }
  | { type: "REORDER_EXERCISE"; exerciseRef: string; ordinal: number }
  | { type: "LOG_SET"; set: SetLogInput }
  | { type: "LOG_MULTIPLE_SETS"; sets: SetLogInput[] }
  | { type: "CORRECT_SET"; targetRef?: string; replacement: Partial<SetInput> }
  | { type: "DELETE_SET"; targetRef?: string }
  | { type: "CHANGE_ACTIVE_EXERCISE"; exerciseRef: string }
  | { type: "SKIP_EXERCISE"; exerciseRef?: string; scope: ChangeScope }
  | { type: "REPLACE_EXERCISE"; fromExerciseRef?: string; toExerciseRef: string; scope: ChangeScope }
  | { type: "ADD_EXERCISE"; exerciseRef: string; scope: ChangeScope }
  | { type: "CREATE_CUSTOM_EXERCISE"; name: string; aliases?: string[]; classificationHint?: string }
  | { type: "MAP_EXERCISE_ALIAS"; alias: string; exerciseRef: string }
  | { type: "CHANGE_SESSION"; sessionRef: string; scope: ChangeScope }
  | { type: "UPDATE_ROUTINE_REQUEST"; requestedChange: RoutineChange; scope: "PERMANENT_ROUTINE" | "AMBIGUOUS" }
  | { type: "FINISH_WORKOUT"; requestedCompletion?: "COMPLETE" | "INCOMPLETE" | "DISCARD" | "CONTINUE" }
  | { type: "QUERY_HISTORY"; queryKind: "LAST_SESSION" | "LAST_EXERCISE" | "BEST_SET"; subject?: QuerySubject; onDate?: string }
  | {
      type: "QUERY_ANALYTICS";
      queryKind: "WEEKLY_PRIMARY_MUSCLE_SETS" | "LAST_TRAINED" | "MONTHLY_WORKOUT_COUNT";
      subject?: QuerySubject;
    }
  | { type: "QUERY_CONVERSATION"; onDate?: string; period?: "MORNING" | "AFTERNOON" | "EVENING"; search?: string }
  | { type: "UNKNOWN"; reason: string };

export type ProposedActionEnvelope = {
  schemaVersion: typeof workoutActionSchemaVersion;
  action: ProposedAction;
  confidence: AiConfidence;
  requiresClarification: boolean;
  clarificationQuestion?: string;
  requestKind?: "USER_DOMAIN_INTENT" | "META_INSTRUCTION" | "POLICY_BYPASS_ATTEMPT";
  requiresConfirmation?: boolean;
  rationaleCodes: string[];
  forbiddenDirectMutation: true;
};

export class ProposedActionSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposedActionSchemaError";
  }
}

export const SetInputSchema = z.object({
  exerciseRef: z.string().optional(),
  loadValue: z.number().finite().optional(),
  weightUnit: z.enum(["KG", "LB"]).optional(),
  loadSemantics: z.enum(["UNSPECIFIED_DEFAULT", "PER_HAND_PER_SIDE", "TOTAL_LOAD", "MACHINE_STACK"]).optional(),
  reps: z.number().int().optional(),
  note: z.string().optional(),
  failedAttemptReps: z.number().int().optional(),
  ordinalRef: z.string().optional()
}).strict();

export const SetLogInputSchema = SetInputSchema.extend({
  reps: z.number().int()
});

const ref = z.string().min(1);
const scope = z.enum(["SESSION_ONLY", "PERMANENT_ROUTINE", "AMBIGUOUS"]);
const RoutineChangeSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("ADD_EXERCISE"), sessionRef: ref, exerciseRef: ref, orderRef: ref.optional() }).strict(),
  z.object({ operation: z.literal("REMOVE_EXERCISE"), sessionRef: ref, exerciseRef: ref }).strict(),
  z.object({ operation: z.literal("REPLACE_EXERCISE"), sessionRef: ref, fromExerciseRef: ref, toExerciseRef: ref }).strict(),
  z.object({ operation: z.literal("REORDER_EXERCISE"), sessionRef: ref, exerciseRef: ref, newOrderRef: ref }).strict(),
  z.object({ operation: z.literal("ADD_SESSION"), routineRef: ref.optional(), sessionName: ref, orderRef: ref.optional() }).strict(),
  z.object({ operation: z.literal("REMOVE_SESSION"), sessionRef: ref }).strict(),
  z.object({ operation: z.literal("REPLACE_SESSION"), fromSessionRef: ref, toSessionRef: ref }).strict(),
  z.object({ operation: z.literal("REORDER_SESSION"), sessionRef: ref, newOrderRef: ref }).strict()
]);
const QuerySubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EXERCISE"), exerciseRef: ref }).strict(),
  z.object({ kind: z.literal("MUSCLE"), muscleRef: ref }).strict(),
  z.object({ kind: z.literal("WORKOUT_SESSION"), workoutRef: ref }).strict(),
  z.object({ kind: z.literal("ROUTINE_SESSION"), sessionRef: ref }).strict(),
  z.object({ kind: z.literal("ROUTINE"), routineRef: ref }).strict()
]);

export const ProposedActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("GREETING") }).strict(),
  z.object({ type: z.literal("HELP") }).strict(),
  z.object({ type: z.literal("PREPARE_SET"), exerciseRef: ref.optional() }).strict(),
  z.object({ type: z.literal("REPEAT") }).strict(),
  z.object({ type: z.literal("CANCEL_PENDING_OPERATION") }).strict(),
  z.object({ type: z.literal("CONTINUE") }).strict(),
  z.object({ type: z.literal("QUERY_PLAN") }).strict(),
  z.object({ type: z.literal("QUERY_CURRENT_STATE") }).strict(),
  z.object({ type: z.literal("COACHING_BOUNDARY") }).strict(),
  z.object({ type: z.literal("ANSWER_PENDING_QUESTION"), answer: z.string().min(1).max(120) }).strict(),
  z.object({ type: z.literal("DRAFT_SETS"), loadValue: z.number().finite().nonnegative(), weightUnit: z.enum(["KG", "LB"]).optional(), count: z.number().int().min(1).max(20) }).strict(),
  z.object({ type: z.literal("START_WORKOUT"), routineRef: ref.optional(), sessionRef: ref.optional() }).strict(),
  z.object({ type: z.literal("RESUME_WORKOUT"), workoutRef: ref.optional() }).strict(),
  z.object({ type: z.literal("NEXT_EXERCISE") }).strict(),
  z.object({ type: z.literal("PREVIOUS_EXERCISE") }).strict(),
  z.object({ type: z.literal("REORDER_EXERCISE"), exerciseRef: ref, ordinal: z.number().int().min(1).max(50) }).strict(),
  z.object({ type: z.literal("LOG_SET"), set: SetLogInputSchema }).strict(),
  z.object({ type: z.literal("LOG_MULTIPLE_SETS"), sets: z.array(SetLogInputSchema).min(1).max(20) }).strict(),
  z.object({ type: z.literal("CORRECT_SET"), targetRef: ref.optional(), replacement: SetInputSchema }).strict(),
  z.object({ type: z.literal("DELETE_SET"), targetRef: ref.optional() }).strict(),
  z.object({ type: z.literal("CHANGE_ACTIVE_EXERCISE"), exerciseRef: ref }).strict(),
  z.object({ type: z.literal("SKIP_EXERCISE"), exerciseRef: ref.optional(), scope }).strict(),
  z.object({ type: z.literal("REPLACE_EXERCISE"), fromExerciseRef: ref.optional(), toExerciseRef: ref, scope }).strict(),
  z.object({ type: z.literal("ADD_EXERCISE"), exerciseRef: ref, scope }).strict(),
  z.object({ type: z.literal("CREATE_CUSTOM_EXERCISE"), name: ref, aliases: z.array(ref).optional(), classificationHint: ref.optional() }).strict(),
  z.object({ type: z.literal("MAP_EXERCISE_ALIAS"), alias: ref, exerciseRef: ref }).strict(),
  z.object({ type: z.literal("CHANGE_SESSION"), sessionRef: ref, scope }).strict(),
  z.object({ type: z.literal("UPDATE_ROUTINE_REQUEST"), requestedChange: RoutineChangeSchema, scope: z.enum(["PERMANENT_ROUTINE", "AMBIGUOUS"]) }).strict(),
  z.object({ type: z.literal("FINISH_WORKOUT"), requestedCompletion: z.enum(["COMPLETE", "INCOMPLETE", "DISCARD", "CONTINUE"]).optional() }).strict(),
  z.object({ type: z.literal("QUERY_HISTORY"), queryKind: z.enum(["LAST_SESSION", "LAST_EXERCISE", "BEST_SET"]), subject: QuerySubjectSchema.optional(), onDate: z.iso.date().optional() }).strict(),
  z.object({ type: z.literal("QUERY_ANALYTICS"), queryKind: z.enum(["WEEKLY_PRIMARY_MUSCLE_SETS", "LAST_TRAINED", "MONTHLY_WORKOUT_COUNT"]), subject: QuerySubjectSchema.optional() }).strict(),
  z.object({ type: z.literal("QUERY_CONVERSATION"), onDate: z.iso.date().optional(), period: z.enum(["MORNING", "AFTERNOON", "EVENING"]).optional(), search: z.string().trim().max(120).optional() }).strict(),
  z.object({ type: z.literal("UNKNOWN"), reason: ref }).strict()
]);

export const ProposedActionEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(workoutActionSchemaVersion),
    action: ProposedActionSchema,
    confidence: z.enum(["low", "medium", "high"]),
    requiresClarification: z.boolean(),
    clarificationQuestion: z.string().optional(),
    requestKind: z.enum(["USER_DOMAIN_INTENT", "META_INSTRUCTION", "POLICY_BYPASS_ATTEMPT"]).optional(),
    requiresConfirmation: z.boolean().optional(),
    rationaleCodes: z.array(z.string()),
    forbiddenDirectMutation: z.literal(true)
  })
  .strict();

export type ConfirmationPolicyDecision = {
  confirmationRequired: boolean;
  clarificationRequired: boolean;
  reasonCodes: string[];
};

const forbiddenKeys = new Set([
  "sql",
  "query",
  "providerOperation",
  "providerRequest",
  "persistenceMutation",
  "directMutation",
  "writeDatabase"
]);

export function parseProposedActionEnvelope(value: unknown): ProposedActionEnvelope {
  assertNoForbiddenKeys(value);
  const envelope = ProposedActionEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    throw new ProposedActionSchemaError(envelope.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  assertNoForbiddenKeys(envelope.data);
  // JSON payloads omit optional undefined properties; Zod's inferred type includes them.
  const action = envelope.data.action as ProposedAction;
  return {
    schemaVersion: workoutActionSchemaVersion,
    action,
    confidence: envelope.data.confidence as AiConfidence,
    requiresClarification: envelope.data.requiresClarification,
    ...(envelope.data.clarificationQuestion ? { clarificationQuestion: envelope.data.clarificationQuestion } : {}),
    ...(envelope.data.requestKind ? { requestKind: envelope.data.requestKind } : {}),
    ...(envelope.data.requiresConfirmation !== undefined ? { requiresConfirmation: envelope.data.requiresConfirmation } : {}),
    rationaleCodes: envelope.data.rationaleCodes,
    forbiddenDirectMutation: true
  };
}

export function evaluateConfirmationPolicy(envelope: ProposedActionEnvelope): ConfirmationPolicyDecision {
  const reasonCodes = new Set<string>();
  if (envelope.requestKind === "META_INSTRUCTION" || envelope.requestKind === "POLICY_BYPASS_ATTEMPT") reasonCodes.add("CLARIFICATION_REQUIRED");
  if (envelope.requiresClarification || envelope.confidence === "low") reasonCodes.add("CLARIFICATION_REQUIRED");

  const action = envelope.action;
  if ("scope" in action && action.scope === "AMBIGUOUS") reasonCodes.add("AMBIGUOUS_SCOPE");
  if ("scope" in action && action.scope === "PERMANENT_ROUTINE") reasonCodes.add("PERMANENT_CHANGE_CONFIRMATION");
  if (action.type === "UPDATE_ROUTINE_REQUEST") reasonCodes.add("PERMANENT_CHANGE_CONFIRMATION");
  if (action.type === "CREATE_CUSTOM_EXERCISE" || action.type === "MAP_EXERCISE_ALIAS") reasonCodes.add("EXERCISE_IDENTITY_CONFIRMATION");
  if (action.type === "DELETE_SET" && action.targetRef !== "last-active-set") {
    reasonCodes.add("DESTRUCTIVE_CONFIRMATION");
  }
  if (action.type === "CORRECT_SET" && action.targetRef?.startsWith("completed:")) {
    reasonCodes.add("COMPLETED_HISTORY_CONFIRMATION");
  }

  return {
    confirmationRequired: [...reasonCodes].some((code) => code.endsWith("_CONFIRMATION")),
    clarificationRequired: reasonCodes.has("CLARIFICATION_REQUIRED") || reasonCodes.has("AMBIGUOUS_SCOPE"),
    reasonCodes: [...reasonCodes]
  };
}

function assertNoForbiddenKeys(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) throw new ProposedActionSchemaError(`Forbidden direct-mutation key: ${key}`);
    assertNoForbiddenKeys(child);
  }
}
