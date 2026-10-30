# Contract: AI Structured Actions

## Closure semantics (2026-10-09)

Prompt v9 keeps QUERY_PLAN as the canonical complete planned-session intent and QUERY_CURRENT_STATE for position/progress. No overlapping QUERY_TODAYS_PLAN alias is introduced. Frozen v6/v7/v8 prompts support same-corpus comparisons. Optional requestKind is USER_DOMAIN_INTENT / META_INSTRUCTION / POLICY_BYPASS_ATTEMPT; requiresConfirmation is advisory and cannot satisfy or waive local policy. Meta/bypass proposals cannot execute. Explicit supplied-authority patterns also fail locally even if the model misclassifies them. Corrections are sparse patches of explicitly changed fields, not copied context snapshots; muscle analytics subjects must retain the requested muscle. A listed exercise alone cannot resolve a pronoun when active/recent references are absent.

## Reliability contract extension (2026-10-09)

Prompt v6 adds locally validated GREETING, HELP, REPEAT, CONTINUE, CANCEL_PENDING_OPERATION, QUERY_PLAN, QUERY_CURRENT_STATE, COACHING_BOUNDARY, ANSWER_PENDING_QUESTION, DRAFT_SETS, NEXT_EXERCISE, PREVIOUS_EXERCISE and session REORDER_EXERCISE proposals. Existing START/RESUME/FINISH, session changes, history/PR/analytics, custom identities, aliases and permanent routine requests remain canonical. Lifecycle choices still pass deterministic confirmation policy; no model field confirms a protected request. Permanent reorder is translated into the existing confirmed routine request.

Pending scope answers may return canonical SESSION_ONLY/PERMANENT_ROUTINE in `answer`; exercise answers preserve the reference. DRAFT_SETS requires an evidenced nonnegative load and 1–20 explicitly supplied sets (single count may be implicit), followed by exact positive completed reps. LOG_MULTIPLE_SETS is bounded to 20 locally. Number-word evidence is bounded lexical validation, not a fuzzy digit correction or an alternative intent engine.

The provider receives an explicit context allowlist, omitting owner IDs, idempotency identifiers and arbitrary caller fields. Current exercise convention, preferred unit, same-exercise previous set, recent references, pending question/parent and partial draft are available. Gemini schemas omit provider array bounds after live HTTP-400 diagnostics; strict local schemas retain every bound and field whitelist. Model numeric/scope/identity proposals remain untrusted until domain validation. Low-confidence replacement targets are not retained for later accidental authorization.

## Conversation Context (2026-10-08)

Prompt v5 adds bounded `conversationMode`, pending operation/slot, current exercise, known owner-visible names/confirmed aliases and allowed action types. These are data, never instructions or permission. The local `workout-action.v1` ProposedActionEnvelope and Gemini provider schema remain unchanged. Low confidence or missing targets clarify; unsupported numeric proposals cannot enter a continuation. Pending answers are interpreted deterministically before AI. The orchestrator owns memory; Gemini never authors ConversationState, confirmations or authoritative factual values. Normal fixtures use mocks, with live provider evaluation still explicitly opt-in.

The AI layer returns proposed actions only. These actions are untrusted until local schema validation, authorization, domain validation, confirmation policy, and idempotent command execution succeed. `confidence` is advisory only and cannot bypass authorization, domain validation, required clarification, permanent-change confirmation, or destructive-action confirmation.

## Envelope

```ts
type ProposedActionEnvelope = {
  schemaVersion: "workout-action.v1";
  action: ProposedAction;
  confidence: "low" | "medium" | "high";
  requiresClarification: boolean;
  clarificationQuestion?: string;
  rationaleCodes: string[];
  forbiddenDirectMutation: true;
};
```

## Common Types

```ts
type WeightUnit = "KG" | "LB";
type LoadSemantics =
  | "UNSPECIFIED_DEFAULT"
  | "PER_HAND_PER_SIDE"
  | "TOTAL_LOAD"
  | "MACHINE_STACK";

type SetInput = {
  exerciseRef?: string;
  loadValue?: number;
  weightUnit?: WeightUnit;
  loadSemantics?: LoadSemantics;
  reps?: number;
  note?: string;
  failedAttemptReps?: number;
  ordinalRef?: string;
};

type SetLogInput = {
  exerciseRef?: string;
  loadValue?: number;
  weightUnit?: WeightUnit;
  loadSemantics?: LoadSemantics;
  reps: number;
  note?: string;
  failedAttemptReps?: number;
};

type ChangeScope = "SESSION_ONLY" | "PERMANENT_ROUTINE" | "AMBIGUOUS";

type RoutineChange =
  | { operation: "ADD_EXERCISE"; sessionRef: string; exerciseRef: string; orderRef?: string }
  | { operation: "REMOVE_EXERCISE"; sessionRef: string; exerciseRef: string }
  | { operation: "REPLACE_EXERCISE"; sessionRef: string; fromExerciseRef: string; toExerciseRef: string }
  | { operation: "REORDER_EXERCISE"; sessionRef: string; exerciseRef: string; newOrderRef: string }
  | { operation: "ADD_SESSION"; routineRef?: string; sessionName: string; orderRef?: string }
  | { operation: "REMOVE_SESSION"; sessionRef: string }
  | { operation: "REPLACE_SESSION"; fromSessionRef: string; toSessionRef: string }
  | { operation: "REORDER_SESSION"; sessionRef: string; newOrderRef: string };

type QuerySubject =
  | { kind: "EXERCISE"; exerciseRef: string }
  | { kind: "MUSCLE"; muscleRef: string }
  | { kind: "WORKOUT_SESSION"; workoutRef: string }
  | { kind: "ROUTINE_SESSION"; sessionRef: string }
  | { kind: "ROUTINE"; routineRef: string };
```

## Discriminated Actions

```ts
type ProposedAction =
  | { type: "START_WORKOUT"; routineRef?: string; sessionRef?: string }
  | { type: "RESUME_WORKOUT"; workoutRef?: string }
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
  | { type: "QUERY_HISTORY"; queryKind: "LAST_SESSION" | "LAST_EXERCISE" | "BEST_SET"; subject?: QuerySubject }
  | { type: "QUERY_ANALYTICS"; queryKind: "WEEKLY_PRIMARY_MUSCLE_SETS" | "LAST_TRAINED" | "MONTHLY_WORKOUT_COUNT"; subject?: QuerySubject }
  | { type: "UNKNOWN"; reason: string };
```

## Validation Rules

- Missing required numeric values cannot be invented.
- `LOG_SET` and `LOG_MULTIPLE_SETS` require `reps` in the structured payload and deterministic validation of exercise identity before persistence.
- Correction replacement payloads may be partial because the existing target record supplies current state.
- `same` resolution is not an AI field; the application resolves it from confirmed context.
- `scope = PERMANENT_ROUTINE` always routes through confirmation before mutation.
- `UPDATE_ROUTINE_REQUEST.requestedChange` must match a supported structured routine-change operation; unsupported free-form changes require clarification or `UNKNOWN`.
- `scope = AMBIGUOUS` cannot mutate routine templates.
- `DELETE_SET` for anything except unambiguous active-workout last set requires clarification or confirmation.
- Completed-history corrections require confirmation.
- `QUERY_HISTORY` and `QUERY_ANALYTICS` may only answer supported bounded questions from persisted data, and their subject kind must determine whether resolution targets an exercise, muscle, workout/session, routine, or another supported subject.
- Unsupported coaching or programming requests must become `UNKNOWN` or a bounded query with forbidden recommendation outcome.
