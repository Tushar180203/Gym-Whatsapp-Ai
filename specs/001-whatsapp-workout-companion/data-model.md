# Data Model: WhatsApp Workout Companion

**Feature**: [spec.md](./spec.md)  
**Date**: 2026-10-06

## Modeling Principles

- User-owned data always carries `userId` or is reachable through a user-owned parent.
- Provider-specific identifiers stay in messaging/link tables, not workout domain tables.
- Exercise identity is stable. Names and aliases can change without rewriting workout history.
- Completed workout sessions snapshot planned details and session-only modifications.
- `WorkoutSet` is the durable source of truth for current set state; `Correction` is the audit trail with before/after state.
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
- `IN_PROGRESS`
- `SKIPPED`
- `REPLACED`
- `COMPLETED`

### SetStatus

- `RECORDED`
- `DELETED`

### InboundProcessingStatus

- `RECEIVED`
- `PROCESSING`
- `COMPLETED`
- `FAILED_RETRYABLE`
- `FAILED_FINAL`

### CommandExecutionStatus

- `PROCESSING`
- `COMPLETED`
- `FAILED_RETRYABLE`
- `FAILED_FINAL`

### OutboundDeliveryStatus

- `PENDING`
- `SENT`
- `FAILED_RETRYABLE`
- `FAILED_FINAL`

### RoutineSequenceProgressionPolicy

- `ADVANCE_NORMAL_SEQUENCE`
- `DO_NOT_ADVANCE_NORMAL_SEQUENCE`
- `SET_CURSOR_EXPLICITLY`

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

### WhatsAppProviderAccount

Represents the product-controlled WhatsApp Business/provider account that sends and receives messages for many product users.

Fields:

- `id`
- `provider`
- `providerAccountId`
- `displayName`
- `status`
- `createdAt`
- `updatedAt`

Relationships:

- Has many `WhatsAppProviderUserIdentity`.
- Has many `InboundMessage`.

Validation rules:

- Active `(provider, providerAccountId)` identifies a provider account, not a product user.
- A provider account may serve many product users.

### WhatsAppProviderUserIdentity

Represents an end-user WhatsApp identity observed through a provider account.

Fields:

- `id`
- `whatsAppProviderAccountId`
- `providerUserIdentityHash`
- `displayPhoneLast4`
- `status`
- `firstSeenAt`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

Relationships:

- Belongs to one `WhatsAppProviderAccount`.
- Has zero or one active `WhatsAppIdentityLink`.
- Has many `InboundMessage`.

Validation rules:

- Active `(provider, providerAccountId, providerUserIdentityHash)` must map to at most one active product user link.
- Active `(whatsAppProviderAccountId, providerUserIdentityHash)` must be unique.
- Raw `wa_id` or phone number is not stored by default; use `providerUserIdentityHash` plus last 4 digits for display.
- The same provider account can contain many user identities.

### WhatsAppIdentityLink

Associates one provider-scoped end-user WhatsApp identity with exactly one product user account.

Fields:

- `id`
- `userId`
- `whatsAppProviderUserIdentityId`
- `status`
- `linkedAt`
- `revokedAt`

Validation rules:

- Active `whatsAppProviderUserIdentityId` must be unique so one active provider user identity cannot belong to multiple product users.
- Multiple product users may link through the same `WhatsAppProviderAccount`, as long as each has a distinct active `WhatsAppProviderUserIdentity`.
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
- Has one `RoutineSequenceCursor` when active.

Validation rules:

- Routine belongs to one user.
- Frequency/schedule metadata informs cadence and reminders but does not automatically advance sequence.

### RoutineSequenceCursor

Tracks normal routine rotation independently from the most recently completed workout.

Fields:

- `id`
- `routineId`
- `userId`
- `nextSessionTemplateId` nullable
- `cursorSequenceIndex` nullable
- `lastAdvancedByWorkoutSessionId` nullable
- `updatedReason`
- `createdAt`
- `updatedAt`

Validation rules:

- There is at most one active cursor per routine.
- Starting or completing an off-sequence workout for the current session does not advance or rewrite this cursor unless the user explicitly requests a permanent sequence change.
- Completing the expected normal session advances the cursor according to routine sequence order.
- Explicit user requests may set the cursor to a chosen template or sequence position.

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
- `activeSessionExerciseId` nullable
- `sequenceProgressionPolicy`
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
- `activeSessionExerciseId` represents the current conversational exercise context only.
- `COMPLETED` advances routine sequence only when `sequenceProgressionPolicy = ADVANCE_NORMAL_SEQUENCE`; `INCOMPLETE`, `DISCARDED`, `CANCELLED_REPLACED`, and off-sequence completions do not.
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
- `IN_PROGRESS` means the user has worked on the exercise but has not marked it completed.
- Active exercise changes only on explicit user intent and do not force the previous exercise to `COMPLETED`.
- Logging sets never auto-advances `WorkoutSession.activeSessionExerciseId`.

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
- `deletedAt`
- `createdAt`
- `updatedAt`

Validation rules:

- `exerciseIdentityId`, `setIndex`, and `reps` are required for a recorded set.
- `loadValue`, `weightUnit`, and `loadSemantics` are required for weighted sets when safely known.
- Omitted unit may use profile preference only when context is safe.
- `PER_HAND_PER_SIDE` is not converted into `TOTAL_LOAD` for durable history.
- Duplicate `idempotencyKey` cannot create another set.
- Corrections update this record in place after validation; before/after state is preserved in `Correction`.
- Soft-deleted records remain auditable and are excluded from analytics, PRs, and normal history answers.

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
- `beforeSnapshot` and `afterSnapshot` capture the state change; immutable set-version chains are not part of MVP.

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
- `whatsAppProviderAccountId`
- `providerUserIdentityHash` nullable
- `whatsAppProviderUserIdentityId` nullable
- `whatsAppIdentityLinkId` nullable
- `userId` nullable
- `receivedAt`
- `rawPayloadHash`
- `textRedacted`
- `processingStatus`
- `commandExecutionId` nullable
- `outboundMessageId` nullable
- `processedAt`
- `errorCategory`
- `retryAfterAt` nullable

Validation rules:

- `(whatsAppProviderAccountId, providerMessageId)` is unique.
- `(provider, providerAccountId, providerUserIdentityHash)` resolves the provider-scoped end-user identity for linked-user lookup; `providerAccountId` alone is never treated as a product user identity.
- Unlinked messages cannot execute workout-affecting commands.
- Duplicate webhook behavior depends on prior state: completed processing returns the stored result, in-flight processing returns a safe in-progress response or no-op retry signal, retryable failures may resume from command idempotency state, already-applied commands do not apply again, and already-sent outbound responses are not resent unless the messaging boundary marks the send retryable and safe.

### CommandExecution

Idempotent application command record.

Fields:

- `id`
- `userId`
- `commandType`
- `idempotencyKey`
- `status`
- `resultSummary`
- `appliedAt`
- `retryAfterAt` nullable
- `errorCategory` nullable
- `createdAt`
- `completedAt`

Validation rules:

- `(userId, idempotencyKey)` is unique.
- Retried commands return prior result.
- A duplicate webhook after a command is already applied returns the command result and does not mutate state again.
- Retryable failures can be retried using the same idempotency key.

### OutboundMessage

Provider-normalized outbound message record.

Fields:

- `id`
- `userId`
- `inboundMessageId` nullable
- `provider`
- `whatsAppProviderAccountId`
- `providerUserIdentityHash`
- `whatsAppProviderUserIdentityId` nullable
- `bodyHash`
- `status`
- `providerOutboundMessageId` nullable
- `sentAt` nullable
- `errorCategory` nullable
- `createdAt`
- `updatedAt`

Validation rules:

- Outbound responses are correlated to inbound processing when applicable.
- Duplicate inbound retries reuse the recorded outbound result when already sent.

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
- `COMPLETED` advances sequence selection only when the session's progression policy permits it.
- `done` with unfinished planned work creates a pending choice, not automatic completion.

### SessionExercise

```text
PLANNED -> ACTIVE
ACTIVE -> IN_PROGRESS
PLANNED -> IN_PROGRESS
IN_PROGRESS -> ACTIVE
IN_PROGRESS -> COMPLETED
ACTIVE -> COMPLETED
PLANNED or ACTIVE -> SKIPPED
IN_PROGRESS -> SKIPPED
PLANNED or ACTIVE or IN_PROGRESS -> REPLACED
```

Rules:

- Logging a set may mark the exercise `IN_PROGRESS` if it was still `PLANNED`, but it does not complete the exercise or change active context automatically.
- Active exercise changes only through explicit command and can move between incomplete exercises.

### WorkoutSet

```text
RECORDED -> DELETED
```

Rules:

- Corrections update the intended existing record while `Correction` stores before/after audit state.
- Deleted records remain auditable but are excluded from analytics and history answers.

## Key Constraints And Indexes

- Unique provider account: `(provider, providerAccountId)` where active.
- Unique provider user identity: `(whatsAppProviderAccountId, providerUserIdentityHash)` where active.
- Unique active WhatsApp link: `whatsAppProviderUserIdentityId` where active.
- Unique inbound message: `(whatsAppProviderAccountId, providerMessageId)`.
- Unique command idempotency: `(userId, idempotencyKey)`.
- One active workout: partial unique index on `WorkoutSession(userId)` where status in `PROPOSED`, `ACTIVE`, `PAUSED`.
- One routine cursor: partial unique index on `RoutineSequenceCursor(routineId)` for active routines.
- Unique routine sequence: `(routineId, sequenceIndex)` for active templates.
- Unique set index per session exercise for non-deleted current records.
- Unique confirmed alias per user normalized text, with ambiguity handled through status or explicit disambiguation.

## Derived Query Services

- `RoutineSequenceService`: chooses next session from `RoutineSequenceCursor`, routine sequence order, and explicit user choices; it does not infer cursor state solely from the latest completed session.
- `PreviousPerformanceService`: latest comparable occurrence for exact exercise identity, unit, and load semantics.
- `PersonalRecordService`: derives PRs on demand from current valid `WorkoutSet` records using exact exercise identity, compatible units, compatible load semantics, and non-deleted state.
- `MuscleAnalyticsService`: weekly primary-muscle sets with confirmed classification.
- `WorkoutAnalyticsService`: frequency, completed count, last-trained dates, monthly counts.
- `HistoryQuestionService`: bounded factual answers from persisted records.
