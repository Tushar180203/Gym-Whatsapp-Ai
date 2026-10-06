# Data Model: WhatsApp Workout Companion

**Feature**: [spec.md](./spec.md)  
**Date**: 2026-10-06

## Modeling Principles

- User-owned data always carries `userId` or is reachable through a user-owned parent.
- Provider-specific identifiers stay in messaging/link tables, not workout domain tables.
- Exercise identity is stable. Names and aliases can change without rewriting workout history.
- Completed workout sessions snapshot planned details and session-only modifications.
- Corrections produce deterministic source-of-truth records and audit/correction entries.
- Analytics and PRs are derived from persisted structured data.

## Enumerations

### WeightUnit

- `KG`
- `LB`

### LoadSemantics

- `UNSPECIFIED_DEFAULT`
- `PER_HAND_PER_SIDE`
- `TOTAL_LOAD`
- `MACHINE_STACK`

### ExerciseIdentityKind

- `GLOBAL`
- `USER_CUSTOM`

### ClassificationStatus

- `CONFIRMED`
- `UNCERTAIN`
- `UNCLASSIFIED`

### WorkoutSessionStatus

- `PROPOSED`
- `ACTIVE`
- `PAUSED`
- `INCOMPLETE`
- `COMPLETED`
- `DISCARDED`
- `CANCELLED_REPLACED`

### SessionExerciseStatus

- `PLANNED`
- `ACTIVE`
- `SKIPPED`
- `REPLACED`
- `COMPLETED`

### SetStatus

- `RECORDED`
- `CORRECTED`
- `DELETED`

### CorrectionType

- `UPDATE_SET`
- `DELETE_SET`
- `UPDATE_EXERCISE`
- `DELETE_EXERCISE`
- `UPDATE_SESSION`
- `DELETE_WORKOUT`
- `ROUTINE_CHANGE`
- `EXERCISE_ALIAS_OR_MERGE`

### ConfirmationStatus

- `PENDING`
- `CONFIRMED`
- `REJECTED`
- `EXPIRED`
- `APPLIED`

### DataControlRequestType

- `EXPORT`
- `DELETE_ACCOUNT`
- `DELETE_WORKOUT_DATA`

## Entities

### User

Represents an authenticated product account.

Fields:

- `id`
- `email`
- `createdAt`
- `updatedAt`
- `deletedAt`

Relationships:

- Has one `UserProfile`.
- Has zero or more `WhatsAppIdentityLink`.
- Has many `Routine`, `ExerciseIdentity`, `WorkoutSession`, `ExerciseAlias`, `DataControlRequest`.

Validation rules:

- Email must be unique while account is active.
- Deleted users cannot receive workout-affecting commands.

### UserProfile

Stores workout-tracking preferences.

Fields:

- `id`
- `userId`
- `displayName`
- `preferredWeightUnit`
- `timezone`
- `createdAt`
- `updatedAt`

Validation rules:

- `preferredWeightUnit` is required for workout logging fallback.
- Profile fields must stay limited to data needed for defined user journeys.

### WhatsAppIdentityLink

Associates a WhatsApp identity with exactly one user account.

Fields:

- `id`
- `userId`
- `provider`
- `providerAccountId`
- `phoneNumberHash`
- `displayPhoneLast4`
- `status`
- `linkedAt`
- `revokedAt`

Validation rules:

- Active `(provider, providerAccountId)` must be unique.
- Workout-affecting inbound messages from unlinked identities are rejected or safely ignored.

### AccountLinkToken

Short-lived token used to link a web account and WhatsApp identity.

Fields:

- `id`
- `userId`
- `tokenHash`
- `expiresAt`
- `consumedAt`
- `createdAt`

Validation rules:

- Single-use.
- Expired tokens cannot create links.

### Routine

User-created training plan.

Fields:

- `id`
- `userId`
- `name`
- `status`
- `sequenceMode`
- `frequencyMetadata`
- `createdAt`
- `updatedAt`
- `archivedAt`

Relationships:

- Has many `WorkoutSessionTemplate`.

Validation rules:

- Routine belongs to one user.
- Frequency/schedule metadata informs cadence and reminders but does not automatically advance sequence.

### WorkoutSessionTemplate

Named planned workout day/session within a routine.

Fields:

- `id`
- `routineId`
- `name`
- `sequenceIndex`
- `scheduleMetadata`
- `createdAt`
- `updatedAt`
- `archivedAt`

Relationships:

- Has many `PlannedExercise`.

Validation rules:

- `sequenceIndex` is unique within active templates for a routine.
- Completed workout sessions snapshot template details rather than relying on mutable records.

### PlannedExercise

Exercise planned inside a template.

Fields:

- `id`
- `sessionTemplateId`
- `exerciseIdentityId`
- `orderIndex`
- `plannedSetCount`
- `repTargetMin`
- `repTargetMax`
- `notes`
- `createdAt`
- `updatedAt`

Validation rules:

- `plannedSetCount` must be positive.
- Rep target may be exact or range.
- Order is unique within a template.

### ExerciseIdentity

Stable exercise or machine identity.

Fields:

- `id`
- `ownerUserId` nullable for global exercises
- `kind`
- `canonicalName`
- `displayName`
- `defaultLoadSemantics`
- `globalExerciseId` nullable
- `createdAt`
- `updatedAt`
- `archivedAt`

Relationships:

- Has many `ExerciseAlias`.
- Has many `ExerciseMuscleClassification`.
- Has many workout sets through `SessionExercise`.

Validation rules:

- User custom identities are scoped to one user.
- Similar exercises do not merge by default.
- Renames preserve identity.
- Merges require explicit confirmation and audit.

### ExerciseAlias

User-specific phrase mapped to a stable exercise identity.

Fields:

- `id`
- `userId`
- `exerciseIdentityId`
- `aliasText`
- `normalizedAlias`
- `status`
- `confirmedAt`
- `createdAt`
- `updatedAt`

Validation rules:

- Confirmed alias must be unique per user unless explicitly disambiguated.
- Ambiguous alias resolution asks for clarification.

### ExerciseMuscleClassification

Primary and secondary muscle classification.

Fields:

- `id`
- `exerciseIdentityId`
- `muscleGroup`
- `role`
- `status`
- `source`
- `confirmedByUserId`
- `confirmedAt`
- `createdAt`
- `updatedAt`

Validation rules:

- MVP analytics count only `role = PRIMARY` with `status = CONFIRMED`.
- Custom exercises with uncertain or missing classification are excluded from muscle analytics.

### WorkoutSession

Started, active, completed, incomplete, discarded, or replaced workout.

Fields:

- `id`
- `userId`
- `routineId` nullable
- `sessionTemplateId` nullable
- `templateSnapshot`
- `name`
- `status`
- `activeSessionExerciseId`
- `startedAt`
- `completedAt`
- `discardedAt`
- `durationSeconds`
- `completionIntent`
- `version`
- `createdAt`
- `updatedAt`

Relationships:

- Has many `SessionExercise`.
- Has many `WorkoutSet`.
- Has many `Correction`.

Validation rules:

- At most one `PROPOSED`, `ACTIVE`, or `PAUSED` session per user.
- `COMPLETED` advances routine sequence; `INCOMPLETE`, `DISCARDED`, and `CANCELLED_REPLACED` do not.
- Starting while active requires explicit user choice.

### SessionExercise

Exercise instance within a specific workout session.

Fields:

- `id`
- `workoutSessionId`
- `exerciseIdentityId`
- `sourcePlannedExerciseId` nullable
- `orderIndex`
- `status`
- `plannedSetCountSnapshot`
- `repTargetMinSnapshot`
- `repTargetMaxSnapshot`
- `changeReason`
- `sessionOnly`
- `replacedBySessionExerciseId`
- `createdAt`
- `updatedAt`

Validation rules:

- Session-only reorder, skip, add, or replace does not mutate routine templates.
- Active exercise changes only on explicit user intent.

### WorkoutSet

Recorded set.

Fields:

- `id`
- `userId`
- `workoutSessionId`
- `sessionExerciseId`
- `exerciseIdentityId`
- `setIndex`
- `loadValue`
- `weightUnit`
- `loadSemantics`
- `reps`
- `status`
- `note`
- `failedAttemptReps`
- `sourceMessageId` nullable
- `idempotencyKey`
- `correctedFromSetId` nullable
- `deletedAt`
- `createdAt`
- `updatedAt`

Validation rules:

- `exerciseIdentityId`, `setIndex`, and `reps` are required for a recorded set.
- `loadValue`, `weightUnit`, and `loadSemantics` are required for weighted sets when safely known.
- Omitted unit may use profile preference only when context is safe.
- `PER_HAND_PER_SIDE` is not converted into `TOTAL_LOAD` for durable history.
- Duplicate `idempotencyKey` cannot create another set.

### Correction

Audit and command record for edits/deletions.

Fields:

- `id`
- `userId`
- `workoutSessionId` nullable
- `type`
- `targetType`
- `targetId`
- `beforeSnapshot`
- `afterSnapshot`
- `sourceSurface`
- `sourceMessageId` nullable
- `confirmationId` nullable
- `appliedAt`
- `createdAt`

Validation rules:

- Completed-history WhatsApp edits require confirmation before apply.
- Ambiguous targets cannot apply.
- Derived analytics/PRs use corrected durable data.

### PendingConfirmation

Single-use confirmation for destructive, completed-history, identity merge, or permanent routine changes.

Fields:

- `id`
- `userId`
- `actionType`
- `proposedAction`
- `summary`
- `status`
- `expiresAt`
- `confirmedAt`
- `rejectedAt`
- `appliedCommandId`
- `createdAt`

Validation rules:

- Single-use and idempotent.
- Expired confirmations cannot apply.
- Repeated confirmation returns existing applied result.

### InboundMessage

Provider-normalized inbound message for deduplication and audit.

Fields:

- `id`
- `provider`
- `providerMessageId`
- `providerAccountId`
- `whatsAppIdentityLinkId` nullable
- `userId` nullable
- `receivedAt`
- `rawPayloadHash`
- `textRedacted`
- `processingStatus`
- `processedAt`
- `errorCategory`

Validation rules:

- `(provider, providerMessageId)` is unique.
- Unlinked messages cannot execute workout-affecting commands.

### CommandExecution

Idempotent application command record.

Fields:

- `id`
- `userId`
- `commandType`
- `idempotencyKey`
- `status`
- `resultSummary`
- `createdAt`
- `completedAt`

Validation rules:

- `(userId, idempotencyKey)` is unique.
- Retried commands return prior result.

### PersonalRecord

Deterministically derived or cached PR record.

Fields:

- `id`
- `userId`
- `exerciseIdentityId`
- `recordType`
- `loadValue`
- `weightUnit`
- `loadSemantics`
- `reps`
- `workoutSetId`
- `achievedAt`
- `validFrom`
- `recalculatedAt`

Validation rules:

- Exact confirmed exercise identity.
- Compatible unit and load semantics.
- Recalculated after historical corrections.
- No estimated 1RM in MVP.

### DataControlRequest

Export or deletion request.

Fields:

- `id`
- `userId`
- `type`
- `status`
- `requestedAt`
- `confirmedAt`
- `completedAt`
- `resultLocation`
- `auditSummary`

Validation rules:

- Deletion requires confirmation.
- Export must include user-owned workout data in portable form.

## State Transitions

### WorkoutSession

```text
NONE -> PROPOSED -> ACTIVE -> COMPLETED
NONE -> PROPOSED -> ACTIVE -> INCOMPLETE
NONE -> PROPOSED -> ACTIVE -> DISCARDED
ACTIVE -> PAUSED -> ACTIVE
ACTIVE -> CANCELLED_REPLACED -> PROPOSED or ACTIVE
PROPOSED -> DISCARDED
```

Rules:

- `NONE` is represented by absence of active/proposed/paused sessions.
- Only `COMPLETED` advances sequence selection.
- `done` with unfinished planned work creates a pending choice, not automatic completion.

### SessionExercise

```text
PLANNED -> ACTIVE
ACTIVE -> COMPLETED
PLANNED or ACTIVE -> SKIPPED
PLANNED or ACTIVE -> REPLACED
```

Rules:

- Logging a set does not change the state automatically.
- Active exercise changes only through explicit command.

### WorkoutSet

```text
RECORDED -> CORRECTED
RECORDED -> DELETED
CORRECTED -> CORRECTED
CORRECTED -> DELETED
```

Rules:

- Corrections update the intended existing record.
- Deleted records remain auditable but are excluded from analytics and history answers.

## Key Constraints And Indexes

- Unique active WhatsApp identity: `(provider, providerAccountId)` where active.
- Unique inbound message: `(provider, providerMessageId)`.
- Unique command idempotency: `(userId, idempotencyKey)`.
- One active workout: partial unique index on `WorkoutSession(userId)` where status in `PROPOSED`, `ACTIVE`, `PAUSED`.
- Unique routine sequence: `(routineId, sequenceIndex)` for active templates.
- Unique set index per session exercise for non-deleted current records.
- Unique confirmed alias per user normalized text, with ambiguity handled through status or explicit disambiguation.

## Derived Query Services

- `RoutineSequenceService`: chooses next session from completed history and routine sequence.
- `PreviousPerformanceService`: latest comparable occurrence for exact exercise identity, unit, and load semantics.
- `PersonalRecordService`: highest load and highest reps at same load for exact comparable sets.
- `MuscleAnalyticsService`: weekly primary-muscle sets with confirmed classification.
- `WorkoutAnalyticsService`: frequency, completed count, last-trained dates, monthly counts.
- `HistoryQuestionService`: bounded factual answers from persisted records.
