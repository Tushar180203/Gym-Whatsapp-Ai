# Contract: AI Structured Actions

The AI layer returns proposed actions only. These actions are untrusted until local schema validation, authorization, domain validation, confirmation policy, and idempotent command execution succeed.

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

type ChangeScope = "SESSION_ONLY" | "PERMANENT_ROUTINE" | "AMBIGUOUS";
```

## Discriminated Actions

```ts
type ProposedAction =
  | { type: "START_WORKOUT"; routineRef?: string; sessionRef?: string }
  | { type: "RESUME_WORKOUT"; workoutRef?: string }
  | { type: "LOG_SET"; set: SetInput }
  | { type: "LOG_MULTIPLE_SETS"; sets: SetInput[] }
  | { type: "CORRECT_SET"; targetRef?: string; replacement: Partial<SetInput> }
  | { type: "DELETE_SET"; targetRef?: string }
  | { type: "CHANGE_ACTIVE_EXERCISE"; exerciseRef: string }
  | { type: "SKIP_EXERCISE"; exerciseRef?: string; scope: ChangeScope }
  | { type: "REPLACE_EXERCISE"; fromExerciseRef?: string; toExerciseRef: string; scope: ChangeScope }
  | { type: "ADD_EXERCISE"; exerciseRef: string; scope: ChangeScope }
  | { type: "CREATE_CUSTOM_EXERCISE"; name: string; aliases?: string[]; classificationHint?: string }
  | { type: "MAP_EXERCISE_ALIAS"; alias: string; exerciseRef: string }
  | { type: "CHANGE_SESSION"; sessionRef: string; scope: ChangeScope }
  | { type: "UPDATE_ROUTINE_REQUEST"; requestedChange: string; scope: "PERMANENT_ROUTINE" | "AMBIGUOUS" }
  | { type: "FINISH_WORKOUT"; requestedCompletion?: "COMPLETE" | "INCOMPLETE" | "DISCARD" | "CONTINUE" }
  | { type: "QUERY_HISTORY"; queryKind: "LAST_SESSION" | "LAST_EXERCISE" | "BEST_SET"; subjectRef?: string }
  | { type: "QUERY_ANALYTICS"; queryKind: "WEEKLY_PRIMARY_MUSCLE_SETS" | "LAST_TRAINED" | "MONTHLY_WORKOUT_COUNT"; subjectRef?: string }
  | { type: "UNKNOWN"; reason: string };
```

## Validation Rules

- Missing required numeric values cannot be invented.
- `LOG_SET` and `LOG_MULTIPLE_SETS` require deterministic validation of exercise identity before persistence.
- `same` resolution is not an AI field; the application resolves it from confirmed context.
- `scope = PERMANENT_ROUTINE` always routes through confirmation before mutation.
- `scope = AMBIGUOUS` cannot mutate routine templates.
- `DELETE_SET` for anything except unambiguous active-workout last set requires clarification or confirmation.
- Completed-history corrections require confirmation.
- `QUERY_HISTORY` and `QUERY_ANALYTICS` may only answer supported bounded questions from persisted data.
- Unsupported coaching or programming requests must become `UNKNOWN` or a bounded query with forbidden recommendation outcome.
