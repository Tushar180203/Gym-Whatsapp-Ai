# Contract: AI Evaluation Cases

Evaluation cases live under the future `packages/evals/fixtures` or `evals/` directory. They are version-controlled and run before prompt, schema, or model changes are accepted.

## Case Shape

```yaml
id: log-simple-45x10
schemaVersion: eval-case.v1
requirementRefs:
  - FR-029
  - FR-030
conversationContext:
  activeWorkout: true
  activeExercise: Incline Dumbbell Press
  preferredWeightUnit: KG
  previousSet:
    loadValue: 45
    weightUnit: KG
    loadSemantics: PER_HAND_PER_SIDE
    reps: 10
userInput: "45x10"
expectedAction:
  type: LOG_SET
expectedFields:
  set.loadValue: 45
  set.reps: 10
expectedClarification: null
expectedConfirmationRequired: false
forbiddenOutcomes:
  - createsCustomExercise
  - changesActiveExercise
  - inventsUnitWhenUnsafe
```

## Required Coverage

- Intent detection.
- Simple set logging.
- Multiple set logging.
- Omitted preferred unit.
- Explicit `kg` or `lb` unit.
- Per-hand/per-side load.
- Total load.
- Machine-stack load.
- Valid unspecified/default load semantics.
- No per-hand/per-side-to-total conversion.
- `same` with valid current-exercise context.
- Ambiguous or invalid `same`.
- Immediate correction.
- Correction after moving exercises.
- Ambiguous correction.
- Delete last set.
- Destructive deletion requiring confirmation.
- Confirmed exercise alias.
- Alias conflict.
- First-time custom exercise.
- Similar exercise identities that must remain separate.
- Session-only workout change.
- Clearly permanent routine change.
- Ambiguous session-versus-permanent change.
- Exact previous-performance lookup.
- No exact prior history.
- Bounded history question.
- Bounded analytics question.
- Unsupported coaching request.
- Missing numeric workout data.
- Hallucination prevention.
- Prompt injection attempts.
- AI confidence cannot bypass confirmation or validation.
- Unknown or unsupported intent.

Each case should define, where relevant:

- Conversation context.
- User input.
- Expected structured action.
- Expected extracted fields.
- Expected clarification.
- Expected confirmation requirement.
- Forbidden outcomes.

## Pass Criteria

- Expected action discriminant matches.
- Expected fields match exactly.
- Required clarification is asked when expected.
- Forbidden outcomes do not occur.
- No generated answer invents workout values.
- Destructive or permanent actions do not bypass confirmation.
