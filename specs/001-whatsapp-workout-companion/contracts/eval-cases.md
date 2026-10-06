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
forbiddenOutcomes:
  - createsCustomExercise
  - changesActiveExercise
  - inventsUnitWhenUnsafe
```

## Required Coverage

- Intent detection.
- Simple set logging.
- Multi-set logging.
- `same` resolution.
- Corrections.
- Ambiguous corrections.
- Custom exercises.
- Aliases.
- Session-only versus permanent changes.
- Unknown exercises.
- History questions.
- Unsupported coaching questions.
- Unit and load semantics.
- Destructive actions.
- Hallucination prevention.

## Pass Criteria

- Expected action discriminant matches.
- Expected fields match exactly.
- Required clarification is asked when expected.
- Forbidden outcomes do not occur.
- No generated answer invents workout values.
- Destructive or permanent actions do not bypass confirmation.
