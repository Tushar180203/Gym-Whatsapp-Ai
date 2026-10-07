---
description: "Implementation tasks for WhatsApp Workout Companion"
---

# Tasks: WhatsApp Workout Companion

**Input**: Design documents from `/specs/001-whatsapp-workout-companion/`

**Prerequisites**: `plan.md`, `spec.md`, `data-model.md`, `quickstart.md`, `research.md`, `contracts/`, `checklists/implementation-readiness.md`, `.specify/memory/constitution.md`

**Tests**: Required by the constitution and plan. Test, integration, webhook, Playwright, and eval tasks are placed with the feature behavior they validate.

**Organization**: Tasks are grouped by incremental user-story slices. The first usable vertical slice proves only: create authenticated user -> create routine -> create short-lived WhatsApp link token -> consume it through the normalized inbound provider-scoped identity path -> start workout from the linked identity -> log deterministic sets -> finish workout -> persist/read history.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with adjacent tasks because it touches different files and does not depend on incomplete work
- **[Story]**: User story trace label from `spec.md`
- Each task includes exact file paths and trace refs to functional requirements, contracts, domain invariants, or eval requirements

---

## Phase 1: Setup And Technical Decisions (Shared Infrastructure)

**Purpose**: Establish the TypeScript monorepo, record open technical choices before dependent implementation, and expose the validation command surface without implementing product behavior.

- [X] T001 Compare npm/pnpm/yarn workspace tooling against the plan constraints and record the selected package manager plus rationale in `specs/001-whatsapp-workout-companion/research.md` and any resulting command updates in `specs/001-whatsapp-workout-companion/plan.md` [Trace: Research Open Technical Questions, Plan Technical Context, Constitution XV]
- [X] T002 Compare Prisma and Drizzle against PostgreSQL constraints, migrations, partial indexes, transaction ergonomics, and repository boundaries, then record the selected typed relational access choice in `specs/001-whatsapp-workout-companion/research.md` and `specs/001-whatsapp-workout-companion/plan.md` before persistence tasks begin [Trace: Research Typed Relational Access, Plan Data And Persistence, Constitution XV]
- [X] T003 Compare secure web authentication options against deployment, session invalidation, owner context, testability, and privacy requirements, then record the selected auth provider/library in `specs/001-whatsapp-workout-companion/research.md` and `specs/001-whatsapp-workout-companion/plan.md` before auth implementation begins [Trace: Research Open Technical Questions, Plan Security, FR-001, Constitution XII]
- [X] T004 Create the selected workspace skeleton with `apps/web`, `packages/domain`, `packages/contracts`, `packages/persistence`, `packages/messaging`, `packages/ai`, `packages/analytics`, `packages/evals`, `tests/e2e`, `tests/integration`, and `tests/fixtures` in the selected workspace manifest [Trace: T001 decision, Plan Project Structure, Research TypeScript Monorepo]
- [X] T005 Configure root TypeScript, package metadata, and required scripts `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `eval`, and `dev` in `package.json`, `tsconfig.base.json`, and `.gitignore` using the selected package manager [Trace: T001 decision, Quickstart Expected Commands, Constitution X]
- [X] T006 [P] Configure Vitest shared test setup for packages and integration tests in `vitest.config.ts` and `tests/fixtures/test-env.ts` [Trace: Plan Testing, Quickstart validation scenarios]
- [ ] T007 [P] Configure ESLint and Prettier for strict TypeScript in `eslint.config.mjs` and `.prettierrc.json` [Trace: Plan Technical Context]
- [ ] T008 [P] Bootstrap the Next.js web/API app with strict TypeScript app router in `apps/web/package.json`, `apps/web/tsconfig.json`, and `apps/web/app/layout.tsx` [Trace: Plan Technical Context, API Contract]
- [ ] T009 Add environment parsing and redacted config helpers for database, auth, WhatsApp, AI, rate limiting, and app URL in `packages/contracts/src/env.ts` and `apps/web/server/env.ts` [Trace: Quickstart Prerequisites, Plan Security, Constitution XII]
- [X] T010 Document local setup commands, selected technical decisions, and required environment variables in `README.md` [Trace: Quickstart Prerequisites, T001-T003, Constitution XVIII]

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create shared contracts, persistence base, command boundaries, real auth ownership primitives, confirmation/idempotency foundations, rate limiting, and observability needed by every user story.

**Critical**: No user-story implementation starts until this phase is complete.

- [X] T011 Define shared enums and Zod primitives for `WeightUnit` values `KG|LB`, `LoadSemantics` values `UNSPECIFIED_DEFAULT|PER_HAND_PER_SIDE|TOTAL_LOAD|MACHINE_STACK`, workout/session/set statuses, inbound processing statuses `RECEIVED|PROCESSING|COMPLETED|FAILED_RETRYABLE`, confirmations, and data-control types in `packages/contracts/src/domain/enums.ts` [Trace: Data Model Enumerations, AI Actions Common Types, Messaging Deduplication]
- [X] T012 Define `ProposedActionEnvelope` and all discriminated AI action Zod schemas with `schemaVersion: "workout-action.v1"` and `forbiddenDirectMutation: true` in `packages/contracts/src/ai/actions.ts` [Trace: Contract ai-actions.md, FR-070-FR-072]
- [ ] T013 [P] Define web/API request and response schemas for profile, WhatsApp linking, routines, exercises, workouts, analytics, export, deletion, and webhook normalized messages in `packages/contracts/src/api/*.ts` [Trace: Contract api.md]
- [ ] T014 [P] Define provider-independent messaging interfaces and inbound/outbound result types in `packages/messaging/src/interfaces.ts` [Trace: Contract messaging.md, Plan WhatsApp Integration]
- [X] T015 Configure the selected typed relational access client and migration layout in `packages/persistence/drizzle.config.ts` or `packages/persistence/prisma/schema.prisma`, `packages/persistence/src/db.ts`, and `packages/persistence/migrations/.gitkeep` [Trace: T002 decision, Plan Storage, Research Typed Relational Access]
- [X] T016 Create base database schema for users, profiles, auth sessions/accounts, WhatsApp provider accounts, provider user identities, links, link tokens, inbound messages, command executions, outbound messages, pending confirmations, rate-limit records if needed, and data-control requests in `packages/persistence/src/schema/account-messaging.ts` or `packages/persistence/prisma/schema.prisma` [Trace: Data Model User, UserProfile, WhatsApp*, AccountLinkToken, InboundMessage, CommandExecution, OutboundMessage, PendingConfirmation, DataControlRequest]
- [X] T017 Create base database schema for routines, sequence cursors, session templates, planned exercises, exercise identities, aliases, muscle classifications, workout sessions, session exercises, sets, and corrections in `packages/persistence/migrations/0001_vertical_slice.sql`, `packages/persistence/migrations/0002_us4.sql`, and `packages/persistence/migrations/0007_core_configuration.sql` [Trace: Data Model Routine through Correction]
- [X] T018 Add database constraints for active user email uniqueness, active auth session lookup, active WhatsApp link uniqueness, `(whatsAppProviderAccountId, providerMessageId)` inbound uniqueness, `(userId, idempotencyKey)` command uniqueness, one active workout partial unique index, routine cursor uniqueness, routine sequence uniqueness, current set index uniqueness, and confirmed alias uniqueness in `packages/persistence/src/schema/indexes.ts` or `packages/persistence/prisma/schema.prisma` [Trace: Data Model Key Constraints And Indexes, CHK001, CHK028-CHK031]
- [X] T019 Add persistence repositories with owner-scoped query helpers and transaction wrapper in `packages/persistence/src/postgres.ts`, `packages/persistence/src/configuration.ts`, and `packages/persistence/src/us4.ts` [Trace: Constitution XII, Plan Data And Persistence]
- [X] T020 Implement selected secure session auth primitives for authenticated user context, session creation, session lookup, logout/session invalidation, and test helpers in `apps/web/server/auth.ts` and `packages/domain/src/auth/session-context.ts` [Trace: T003 decision, FR-001, Plan Security]
- [X] T021 Create authorization guard utilities that require authenticated owner context for every user-owned resource in `packages/domain/src/auth/ownership.ts` [Trace: FR-072, API ownership rules, Constitution XII]
- [X] T022 Create idempotent command executor and command-result model in `packages/domain/src/commands/command-executor.ts` [Trace: Plan Concurrency And Idempotency, Data Model CommandExecution]
- [ ] T023 Create pending confirmation service with deterministic yes/confirm/no/cancel/never-mind resolution, single-use application, expiry, repeated-confirmation idempotency, stale target/version detection, ambiguous pending handling, and audit metadata in `packages/domain/src/confirmations/confirmation-service.ts` [Trace: Data Model PendingConfirmation, Confirmation Safety, FR-039c, FR-039f, FR-049e, FR-076]
- [ ] T024 Implement provider-independent application rate-limit boundary for auth-sensitive endpoints, expensive AI interpretation paths, and abusive inbound messaging identities in `packages/domain/src/rate-limit/rate-limit-service.ts` and `apps/web/server/rate-limit.ts` without requiring distributed infrastructure for MVP [Trace: Plan Security, hosting constraints, Constitution XIX]
- [ ] T025 Implement safe structured observability events and redacted logging for webhook verification failure, duplicate inbound message, processing failure, AI schema/interpretation failure, domain validation failure, confirmation required/expired/applied, outbound message failure, and deterministic-vs-AI path latency in `packages/domain/src/observability/events.ts` and `apps/web/server/observability.ts` [Trace: Plan Security logging limits, Constitution XII and XVIII]
- [X] T026 [P] Add unit tests for AI action schema validation, including confidence cannot bypass confirmation or validation, in `packages/contracts/src/ai/actions.test.ts` [Trace: Contract ai-actions.md, CHK032-CHK033]
- [ ] T027 [P] Add integration tests for database unique constraints and owner scoping in `tests/integration/persistence/constraints.test.ts` [Trace: Data Model Key Constraints And Indexes, CHK001, CHK025-CHK031]
- [ ] T028 Add unit tests for idempotent command execution and pending confirmation handling covering accepted, rejected, expired, already applied, repeated confirmation, stale target/version, no pending confirmation, ambiguous/multiple pending confirmations if permitted, and permanent/destructive command at-most-once behavior in `packages/domain/src/commands/command-executor.test.ts` and `packages/domain/src/confirmations/confirmation-service.test.ts` [Trace: PendingConfirmation, Confirmation Safety, Messaging Deduplication, CHK030-CHK031]
- [X] T029 Add security tests for real auth session creation, authenticated user context, logout/session invalidation, owner-scoped authorization, and cross-user isolation in `tests/integration/security/auth-ownership.test.ts` [Trace: FR-001, FR-005, Constitution XII]

**Checkpoint**: Shared contracts, schema constraints, real auth, ownership, idempotency, confirmation policy, rate limits, and safe observability are ready.

---

## Phase 3: User Story 1 - Configure Account, Profile, WhatsApp Token, And Routine (Priority: P1)

**Goal**: A user can create an account, configure preferred units, generate/manage a short-lived WhatsApp link token, and create routines with known/custom exercises, aliases, planned sets, rep targets, order, and frequency.

**Independent Test**: Complete onboarding, generate/manage a WhatsApp link token or simulate an already linked provider identity through the same ownership-checked persistence path, create a two-session routine with known and custom exercises, verify ownership, alias reuse, and future-only routine edits. Full provider-message link ownership is not claimed until the inbound token-consumption path exists in US2.

### Tests for User Story 1

- [X] T030 [P] [US1] Add contract tests for auth/profile/link-token/routine/exercise endpoints in `tests/integration/routines/configuration-contract.test.ts`, `tests/e2e/us1-onboarding-routine.spec.ts`, and `tests/e2e/core-validation-scenario.spec.ts` [Trace: US1, FR-001-FR-018h, Contract api.md]
- [X] T031 [P] [US1] Add domain tests for custom exercise identity, alias confirmation/reuse, alias conflict, similar-exercise no-auto-merge, and rename preserving identity in `tests/postgres/phase-a-configuration.test.ts` and `tests/postgres/us4.test.ts` [Trace: US1, FR-016-FR-018h, Eval alias conflict and no-auto-merge]
- [X] T032 [P] [US1] Add integration tests proving routine edits affect future templates only and completed snapshots are not rewritten in `tests/postgres/phase-a-configuration.test.ts` [Trace: US1, FR-024, FR-041, Data Model WorkoutSessionTemplate]
- [X] T033 [P] [US1] Add Playwright onboarding and routine-setup flow test in `tests/e2e/us1-onboarding-routine.spec.ts` [Trace: US1 Independent Test, Quickstart Core Validation Scenario steps 1-5]

### Implementation for User Story 1

- [X] T034 [P] [US1] Implement account signup using the selected real secure session implementation and authenticated user context in `apps/web/server/auth.ts` and `apps/web/app/api/auth/signup/route.ts` [Trace: T003, T020, FR-001, Contract POST /api/auth/signup]
- [X] T035 [P] [US1] Implement `POST /api/auth/logout` route that requires the current authenticated session, invalidates that session, returns a safe idempotent success result for repeated logout where appropriate, and never deletes account or workout data in `apps/web/app/api/auth/logout/route.ts` [Trace: T020, Contract POST /api/auth/logout, secure sessions, Constitution XII]
- [X] T036 [P] [US1] Implement profile service with `preferredWeightUnit` required for workout logging fallback and profile fields limited to defined journeys in `packages/domain/src/profile/profile-service.ts` [Trace: FR-002-FR-003, Data Model UserProfile validation]
- [X] T037 [US1] Implement profile API routes in `apps/web/app/api/profile/route.ts` [Trace: FR-002-FR-003, Contract GET/PATCH /api/profile]
- [X] T038 [P] [US1] Implement short-lived single-use WhatsApp link token creation, status, revoke, and test-only linked-identity fixture helpers without web-only identity binding in `packages/domain/src/messaging/link-service.ts` [Trace: FR-004, Data Model AccountLinkToken and WhatsAppIdentityLink]
- [X] T039 [US1] Implement WhatsApp link-token API routes in `apps/web/app/api/whatsapp/link-token/route.ts`, `apps/web/app/api/whatsapp/link/route.ts`, and `apps/web/app/api/whatsapp/link/[id]/route.ts` for token lifecycle only, not provider identity proof [Trace: FR-004, Contract WhatsApp Linking]
- [X] T040 [P] [US1] Implement exercise identity service for global and `USER_CUSTOM` exercise creation, scoped ownership, rename-preserves-identity, and explicit merge-confirmation requests in `packages/persistence/src/configuration.ts` and `packages/persistence/src/us4.ts` [Trace: FR-013-FR-018h, Data Model ExerciseIdentity]
- [X] T041 [US1] Implement alias resolution service with confirmed alias uniqueness per user, ambiguity clarification, and reuse-after-confirmation in `packages/persistence/src/configuration.ts` and `packages/persistence/src/us4.ts` [Trace: FR-018a-FR-018c, Data Model ExerciseAlias]
- [X] T042 [P] [US1] Implement muscle classification service where MVP analytics count only `role = PRIMARY` with `status = CONFIRMED` and uncertain custom exercises remain excluded in `packages/persistence/src/postgres.ts`, `packages/persistence/src/analytics-queries.ts`, and `packages/analytics/src/workout-analytics-service.ts` [Trace: FR-064-FR-066d, Data Model ExerciseMuscleClassification]
- [X] T043 [US1] Implement routine service for routines, templates, planned exercises, positive `plannedSetCount`, exact/range rep targets, unique order, schedule metadata, and routine sequence cursor creation in `packages/persistence/src/configuration.ts` [Trace: FR-006-FR-012, Data Model Routine, WorkoutSessionTemplate, PlannedExercise, RoutineSequenceCursor]
- [X] T044 [US1] Implement routine API routes in `apps/web/app/api/routines/route.ts` and `apps/web/app/api/routines/[routineId]/route.ts` [Trace: FR-006-FR-012, Contract Routines]
- [X] T045 [US1] Implement exercise and alias API routes in `apps/web/app/api/exercises/route.ts`, `apps/web/app/api/exercises/custom/route.ts`, `apps/web/app/api/exercises/[exerciseId]/route.ts`, `apps/web/app/api/exercises/[exerciseId]/aliases/route.ts`, `apps/web/app/api/exercises/[exerciseId]/classification/route.ts`, and `apps/web/app/api/exercises/merge-request/route.ts` [Trace: FR-013-FR-018h, Contract Exercises And Aliases]
- [X] T046 [US1] Build minimal web onboarding and route/page shells for setup and routine management in `apps/web/app/(product)/onboarding/page.tsx` and `apps/web/app/(product)/routines/page.tsx` [Trace: US1, FR-001-FR-012]
- [X] T046A [US1] Build WhatsApp token management UI and API integration states for link status, token creation, revoke, expiry, and ownership-safe errors in `apps/web/components/whatsapp/link-token-manager.tsx` [Trace: US1, FR-004-FR-005]
- [X] T046B [US1] Build routine editor form/state interactions for sessions, planned exercises, planned sets, rep targets, order, and frequency in `apps/web/components/routines/routine-editor.tsx` [Trace: US1, FR-006-FR-012]
- [ ] T046C [US1] Build exercise alias and classification form/state interactions with conflict, confirmation, and uncertain-classification states in `apps/web/components/routines/exercise-identity-controls.tsx` [Trace: US1, FR-013-FR-018h, FR-064-FR-066d]

**Checkpoint**: Account, preferred units, WhatsApp link-token management, routines, stable exercise identities, aliases, and routine edits are independently testable without claiming provider identity E2E linking yet.

---

## Phase 4: User Story 2 - Link Identity And Start A Planned Workout From WhatsApp (Priority: P1)

**Phase A reconciliation (2026-10-07)**: Completed T030-T033, T039-T045, T046/T046A/T046B, T049, T053/T054 and T070 with actual PostgreSQL/API/UI evidence (paths above). T017/T019/T043/T051/T052/T060/T100 now identify the concrete production implementation, not fixture-only re-export files. T036/T037 retain approval with persisted displayName and strict preferences. T061 includes the parser/PG failed-ninth-rep regression. No task IDs added/removed; 134 total, 114 checked, 20 unchecked.

T046C remains partial: alias/rename controls are complete; the existing classification form remains on analytics, not integrated into these setup controls. T048 remains partial for its standalone comprehensive domain-test requirement, including explicit cursor-advancing choice evidence; cursor selection/missed-day independence/off-sequence policy and normal eligible advancement are exercised by PostgreSQL code/tests. T050/T056/T059 remain unchecked: signed POST processing works, but GET verification and real transport are Phase B. T058/T058A completion refers to persisted lifecycle/recovery and isolated mock send-boundary tests, not real provider delivery. T124 now uses real setup APIs and passes signed-inbound-to-review browser acceptance; it remains partial for live outbound. T125 remains partial for provider retry/reconciliation. No transport or privacy decision is marked complete.

**Goal**: A provider-verified inbound WhatsApp identity can consume a short-lived link token, become linked to the product account, start a proposed workout, choose safely among plausible sessions, make session-only changes, skip/rest, or handle an already-active workout without creating a second session.

**Independent Test**: Consume a link token through a verified inbound WhatsApp message, send start phrases from that linked identity, and verify safe next workout proposal, ambiguity prompts, skip/rest behavior, active-workout choices, and permanent routine confirmation.

### Tests for User Story 2

- [ ] T047 [P] [US2] Add domain tests for inbound link-token consumption proving provider-scoped end-user ownership, token expiry, token single-use, wrong token rejection, and no web-only identity binding in `packages/domain/src/messaging/link-service.test.ts` [Trace: FR-004-FR-005, Plan Security WhatsApp linking]
- [ ] T048 [P] [US2] Add domain tests for routine sequence cursor selection, missed calendar days, off-sequence workout choice, and explicit cursor advancement in `packages/domain/src/routines/routine-sequence.test.ts` [Trace: US2, FR-020-FR-024b, CHK022-CHK024]
- [X] T049 [P] [US2] Add workout state-machine tests for one-active-workout, active start choices, replace confirmation, resume, discard, and save incomplete choices in `tests/postgres/phase-a-selection.test.ts`, `tests/postgres/us5.test.ts`, and `tests/postgres/postgres-vertical-slice.test.ts` [Trace: US2, FR-024c-FR-024f, Data Model WorkoutSession]
- [ ] T050 [P] [US2] Add webhook security tests for valid GET challenge, invalid POST signature rejection, unlinked identity no mutation, token-consumption linking, and linked identity processing in `apps/web/tests/integration/whatsapp-webhook-security.test.ts` [Trace: FR-005, Quickstart Webhook Security Validation, Contract messaging.md]

### Implementation for User Story 2

- [X] T051 [US2] Implement routine sequence service that selects from `RoutineSequenceCursor`, never skips missed calendar days, and does not advance for off-sequence sessions unless explicit in `packages/persistence/src/workout-selection.ts` and `packages/persistence/src/workout-lifecycle.ts` [Trace: FR-020, FR-024a-FR-024b, Data Model RoutineSequenceCursor]
- [X] T052 [US2] Implement workout start command that creates `PROPOSED` or `ACTIVE` sessions with template snapshots, session exercises, `sequenceProgressionPolicy`, and one-active-workout enforcement in `packages/persistence/src/workout-selection.ts` and `packages/persistence/src/postgres.ts` [Trace: FR-019-FR-024f, Data Model WorkoutSession, SessionExercise]
- [X] T053 [US2] Implement session-only pre-start modification and skip/rest commands without routine mutation in `packages/persistence/src/workout-selection.ts` and `packages/persistence/src/us4.ts` [Trace: FR-023-FR-024, FR-048-FR-049d]
- [X] T054 [US2] Implement active-workout conflict command choices resume, finish, save incomplete, discard, and replace with explicit replace intent in `packages/persistence/src/workout-selection.ts`, `packages/persistence/src/us4.ts`, and `packages/persistence/src/workout-lifecycle.ts` [Trace: FR-024c-FR-024f]
- [X] T055 [P] [US2] Implement WhatsApp Cloud inbound adapter verification and payload normalization in `packages/messaging/src/whatsapp/inbound-adapter.ts` [Trace: Contract messaging.md Inbound Flow, FR-005]
- [ ] T056 [P] [US2] Implement WhatsApp outbound adapter interface implementation and outbound result persistence boundary in `packages/messaging/src/whatsapp/outbound-adapter.ts` [Trace: Contract messaging.md Outbound Flow]
- [X] T057 [US2] Implement inbound link-token consumption from verified provider messages before any workout mutation in `packages/domain/src/messaging/link-token-consumer.ts` [Trace: FR-004-FR-005, Plan Security WhatsApp linking]
- [X] T058 [US2] Implement inbound message processing lifecycle for `RECEIVED`, `PROCESSING`, `COMPLETED`, and `FAILED_RETRYABLE`, including command already durably applied, outbound response persisted, outbound already sent, crash after command commit before outbound send, and duplicate webhook recovery/reuse without duplicate mutations in `packages/domain/src/messaging/inbound-message-processor.ts` [Trace: Plan Concurrency And Idempotency, Messaging Deduplication, CommandExecution, OutboundMessage]
- [X] T058A [US2] Add core messaging idempotency integration tests for first inbound processing, exact duplicate provider delivery, in-flight duplicate safe handling, retryable failure retry, command already durably applied result reuse, crash after command commit before outbound send, persisted outbound recovery/send, already-sent outbound not duplicated, and concurrent same-user mutation not creating duplicate sets/state in `tests/integration/messaging/core-idempotency.test.ts` [Trace: T058, Messaging Deduplication, CHK029-CHK031; blocks US3]
- [ ] T059 [US2] Implement WhatsApp webhook routes in `apps/web/app/api/webhooks/whatsapp/route.ts` [Trace: Contract Webhook, Quickstart Webhook Security Validation]
- [X] T060 [US2] Implement concise WhatsApp start/proposal/ambiguity/active-workout response formatting in `packages/persistence/src/workout-selection.ts` [Trace: FR-022-FR-023, FR-027]

**Checkpoint**: Provider-verified WhatsApp identity linking is real, linked users can safely start or decline workouts from WhatsApp, and active-session collisions are deterministic.

---

## Phase 5: User Story 3 - Log A Complete Workout Deterministically (Priority: P1)

**Goal**: During an active workout, deterministic parser paths record one set, multiple sets, and safe `same` inputs without AI, preserving structured workout data and keeping exercise context stable.

**Independent Test**: Complete set logging through WhatsApp using `45x10`, `45 kg x 10`, `45 each 10`, `45kg for 10`, `same x 9`, and multi-set messages; verify history preserves exercise identity, set order, load, unit, load semantics, reps, notes, and completion state.

### Tests for User Story 3

- [X] T061 [P] [US3] Add deterministic parser unit tests for `45x10`, `45 kg x 10`, `45 lb x 10`, `45 each 10`, `45kg for 10`, `same x 9`, failed-attempt notes, missing numeric values, preferred-unit fallback when safe, unsafe omitted-unit clarification/failure, valid `UNSPECIFIED_DEFAULT`, `PER_HAND_PER_SIDE`, `TOTAL_LOAD`, and `MACHINE_STACK` resolution in `packages/domain/src/parser/set-parser.test.ts` [Trace: US3, FR-028-FR-031, Quickstart Deterministic Parser Validation]
- [X] T062 [P] [US3] Add multi-set, load-comparison, and idempotency tests for `45x10, 45x9, 45x8`, `bench 80x8 80x8 80x7`, KG/LB handling, `each` mapping to `PER_HAND_PER_SIDE`, no per-side-to-total conversion, incompatible load semantics not comparable, duplicate webhook replay, and retry after partial creation in `packages/domain/src/workouts/log-set-command.test.ts` [Trace: FR-030a-FR-034, Messaging Deduplication, idempotency/retry tests]
- [ ] T063 [P] [US3] Add active-exercise sequencing tests proving planned set count does not auto-advance and extra sets stay on current exercise in `packages/domain/src/workouts/active-exercise-context.test.ts` [Trace: FR-035-FR-035c, active exercise context requirements]

### Implementation for User Story 3

- [X] T064 [US3] Implement deterministic set parser and parsed-action types for supported notation in `packages/domain/src/parser/set-parser.ts` [Trace: FR-028-FR-034, Plan Hybrid Deterministic And AI Strategy]
- [X] T065 [US3] Implement unit and load-semantics resolver where omitted unit uses profile preference only when safe, `each` maps to `PER_HAND_PER_SIDE`, and per-side values are not converted to totals in `packages/domain/src/workouts/load-semantics-service.ts` [Trace: FR-030a-FR-030g, Data Model WorkoutSet]
- [X] T066 [US3] Implement workout set logging command requiring `exerciseIdentityId`, `setIndex`, `reps`, weighted set fields when safely known, and duplicate `idempotencyKey` protection in `packages/domain/src/workouts/log-set-command.ts` [Trace: FR-030-FR-035c, Data Model WorkoutSet validation]
- [X] T067 [US3] Implement multi-set command execution using inbound message id plus action index idempotency keys in `packages/domain/src/workouts/log-multiple-sets-command.ts` [Trace: FR-033-FR-034, Messaging Deduplication]
- [X] T068 [US3] Implement active exercise context service where logging may mark `SessionExercise` `IN_PROGRESS` but never auto-advances `WorkoutSession.activeSessionExerciseId` in `packages/domain/src/workouts/active-exercise-context.ts` [Trace: FR-035-FR-035c, Data Model SessionExercise]
- [X] T069 [US3] Wire deterministic fast-path set logging into inbound message processor before AI interpretation and after pending-confirmation resolution in `packages/domain/src/messaging/inbound-message-processor.ts` [Trace: Plan Execution Flow, PendingConfirmation, Constitution II]
- [X] T070 [US3] Implement workout session and set API routes for active workout read, start, resume, set create, set patch, set delete, finish, discard, and history read in `apps/web/app/api/workouts/active/route.ts`, `apps/web/app/api/workouts/start/route.ts`, `apps/web/app/api/workouts/[workoutId]/route.ts`, `apps/web/app/api/workouts/[workoutId]/resume/route.ts`, `apps/web/app/api/workouts/[workoutId]/sets/route.ts`, `apps/web/app/api/workouts/[workoutId]/sets/[setId]/route.ts`, `apps/web/app/api/workouts/[workoutId]/finish/route.ts`, `apps/web/app/api/workouts/[workoutId]/discard/route.ts`, and `apps/web/app/api/workouts/history/route.ts` [Trace: Contract Workout Sessions And Sets, FR-028-FR-035c]
- [X] T071 [US3] Add concise WhatsApp set-logging responses and clarification responses in `apps/web/server/whatsapp/response-formatters.ts` [Trace: FR-027, FR-032]

**Checkpoint**: Deterministic workout logging can safely mutate structured workout history without AI.

---

## Phase 6: Minimal Finish And History Vertical Slice (Priority: P1)

**Goal**: Finish or save a workout after deterministic set logging and read persisted history without requiring previous-performance or PR services.

**Independent Test**: Create authenticated user, create routine, create a short-lived WhatsApp link token, consume it through the normalized inbound provider-scoped identity path, start workout from the linked identity, log deterministic sets, finish workout, and read persisted history.

### Tests for Minimal Vertical Slice

- [ ] T072 [P] Add finish-workout tests for no recorded sets, all planned work complete/skipped/replaced, unfinished planned work choices, save incomplete, discard, resume, and duration availability in `packages/domain/src/workouts/finish-workout-command.test.ts` [Trace: FR-050-FR-052h, Quickstart Core Validation Scenario]
- [X] T073 [P] Add integration test for the first usable vertical slice proving authenticated product user -> short-lived WhatsApp link token -> normalized inbound provider-scoped identity message using the token -> token consumption -> stable `providerUserIdentityHash` to product-user link -> linked identity starts, logs deterministic sets, finishes workout, and reads persisted history through real application linking flow in `tests/integration/vertical-slices/create-routine-link-start-log-finish-history.test.ts` without live Meta API calls or pre-simulated linked identity acceptance [Trace: User request first usable vertical slice, SC-001, FR-004-FR-005]

### Implementation for Minimal Vertical Slice

- [X] T074 Implement finish workout command and completion choice handling for complete, incomplete, continue, discard, summary, duration, and sequence advancement policy in `packages/domain/src/workouts/finish-workout-command.ts` [Trace: FR-050-FR-052h, Data Model WorkoutSession transitions]
- [X] T075 Implement resume active workout command that keeps subsequent messages on the existing active session in `packages/domain/src/workouts/resume-workout-command.ts` [Trace: FR-024f, FR-052f]
- [X] T076 Implement minimal finish summary formatting for WhatsApp without previous-performance or PR claims in `apps/web/server/whatsapp/response-formatters.ts` [Trace: FR-051-FR-052]
- [X] T077 Implement history persistence query for completed/incomplete workouts and workout details in `packages/persistence/src/queries/workout-history-query.ts` [Trace: FR-053-FR-055, Data Model WorkoutSession]

**Checkpoint**: First usable vertical slice is validated without previous-performance, PR, analytics, or AI-dependent behavior.

---

## Phase 7: AI And Eval Infrastructure (Cross-Story Enabler)

**Purpose**: Add the minimum AI interpretation infrastructure, eval schema/loader, provider adapter, and executable eval command before AI-dependent WhatsApp behavior or fixtures claim to be usable.

- [X] T078 [P] Create eval case schema, loader, and pass/fail reporter for `eval-case.v1` in `packages/evals/src/eval-case-schema.ts` and `packages/evals/src/runner.ts` [Trace: Contract eval-cases.md Case Shape and Pass Criteria]
- [X] T079 Add executable `eval-case.v1` fixture suites after T078 creates the schema/loader for deterministic/AI boundary set and exercise-identity behavior in `packages/evals/fixtures/intent/set-load-behavior.yaml` and `packages/evals/fixtures/intent/exercise-identity.yaml`, covering simple set, multiple sets, omitted unit, explicit KG, explicit LB, per-hand/per-side, total load, machine stack, valid unspecified/default semantics, no per-side-to-total conversion, valid `same`, ambiguous/invalid `same`, missing numeric values, confirmed alias reuse, alias conflict, first-time unknown/custom exercise, similar exercise separation, and no automatic merge, with conversation context, user input, expected action, expected fields, clarification, confirmation requirement, and forbidden outcomes where relevant [Trace: T078, Contract eval-cases.md Required Coverage, Constitution IX]
- [X] T080 Implement provider-independent `IntentInterpreter`, `StructuredOutputClient`, `AiProviderError`, `AiSchemaError`, `AiRateLimitError`, and `PromptRegistry` interfaces in `packages/ai/src/interfaces.ts` [Trace: Plan AI Provider, Constitution XIII]
- [X] T081 Implement prompt registry with strict role separation and user text as untrusted data in `packages/ai/src/prompt-registry.ts` [Trace: Plan Security prompt injection controls, Research Treat User Text As Untrusted Prompt Data]
- [X] T082 Record/select the initial production AI provider and model according to the criteria in plan/research and eval readiness in `specs/001-whatsapp-workout-companion/research.md` and `specs/001-whatsapp-workout-companion/plan.md` [Trace: Research Structured Output Support, Open Technical Questions, Constitution XV]
- [X] T083 Implement one production structured-output provider adapter with provider SDK/types contained inside the adapter and failures mapped to local AI error types in `packages/ai/src/providers/structured-output-client.ts` [Trace: T082 decision, Plan Provider Independence, Constitution XIII]
- [X] T084 Implement mocked structured-output client for deterministic tests and evals in `packages/ai/src/testing/mock-structured-output-client.ts` [Trace: Plan Testing, Evaluation Architecture]
- [X] T085 Implement structured interpreter that validates AI output against local action schemas before returning proposed actions in `packages/ai/src/structured-intent-interpreter.ts` [Trace: FR-070-FR-072, Contract ai-actions.md]
- [X] T086 Add adapter contract tests for provider success, schema mismatch, provider errors, timeout/rate-limit mapping, and no provider types leaking into domain in `packages/ai/src/providers/structured-output-client.contract.test.ts` [Trace: Plan AI Provider, Constitution XIII]
- [X] T087 Add `eval` command wiring, CI-ready offline eval report output, and mandatory AI-regression gate documentation in `packages/evals/package.json` and `package.json` [Trace: Quickstart Expected Commands, Constitution IX]
- [X] T088 Add opt-in real-provider smoke/eval command that is skipped by default in normal offline unit tests in `packages/evals/package.json` and `packages/evals/src/real-provider-smoke.ts` [Trace: T082 decision, Research Structured Output Support, Constitution XVIII]
- [X] T089 Add integration tests proving invalid AI schema, low confidence, prompt-injection text, provider failure, forbidden direct mutation, and AI confidence cannot bypass deterministic validation, authorization, required clarification, destructive confirmation, or permanent-change confirmation in `tests/integration/ai/ai-boundary.test.ts` [Trace: CHK032-CHK035, Constitution III-IV]

**Checkpoint**: AI interpretation and evals are executable as infrastructure, but durable mutations still flow through deterministic validation and command handlers.

---

## Phase 8: User Story 4 - Correct, Reorder, Skip, Replace, And Add During A Session (Priority: P1)

**Goal**: Users can fix mistakes and adapt the current session with deterministic safety and AI-assisted interpretation where needed, without corrupting durable history or silently changing the permanent plan.

**Independent Test**: During an active workout, perform a quick correction, correction after switching exercise, ambiguous correction, completed-history WhatsApp correction requiring confirmation, reorder, skip, replace, add unknown exercise, and permanent-change confirmation.

### Tests for User Story 4

- [X] T090 [P] [US4] Add correction-policy tests for active-workout quick correction, correction after switching exercise, explicit older named exercise/set reference and ordinal set reference such as `incline set 2 was actually 10` while another exercise is active, ambiguous correction requiring clarification, completed-history confirmation, and web completed-history edit in `packages/domain/src/corrections/correction-policy.test.ts` [Trace: FR-036-FR-039g, required correction cases]
- [X] T091 [P] [US4] Add destructive mutation confirmation-policy tests for older set deletion, entire exercise deletion, entire workout deletion, substantial history deletion, identity merge, and permanent routine change in `packages/domain/src/confirmations/destructive-policy.test.ts` [Trace: FR-039e-FR-039f, FR-049e-FR-049f, permanent/destructive mutation tests]
- [X] T092 [P] [US4] Add session mutation tests for reorder, skip, replace, add exercise, unknown exercise confirmation, today-only scope, permanent scope, and ambiguous scope in `packages/domain/src/workouts/session-mutation-commands.test.ts` [Trace: FR-040-FR-049f, session-only change requirements]
- [X] T093 [P] [US4] Add executable `eval-case.v1` fixtures for immediate correction, correction after moving exercises, explicit older named/numbered set correction, ambiguous correction, delete last set, destructive deletion confirmation, session-only change, explicit permanent change, and ambiguous session-versus-permanent scope in `packages/evals/fixtures/intent/us4-corrections-session-changes.yaml`, including expected action, fields, clarification, confirmation requirement, and forbidden outcomes where relevant [Trace: T078, T087, Contract eval-cases.md, AI-related eval cases]

### Implementation for User Story 4

- [X] T094 [US4] Implement correction target resolver for recent active-workout references, named exercise set references, cross-exercise current-workout references, ambiguous targets, and completed-history targets in `packages/domain/src/corrections/correction-target-resolver.ts` [Trace: FR-036-FR-039d, CHK019]
- [X] T095 [US4] Implement correction command that updates `WorkoutSet` in place, writes `Correction` before/after snapshots, and excludes soft-deleted sets from normal history in `packages/domain/src/corrections/correction-command.ts` [Trace: FR-037-FR-039g, Data Model Correction]
- [X] T096 [US4] Implement deletion command where unambiguous active `delete last set` may execute directly and older, ambiguous, exercise, workout, or substantial history deletion requires clarification or confirmation in `packages/domain/src/corrections/delete-command.ts` [Trace: FR-039e-FR-039f, confirmation-policy tests]
- [X] T097 [US4] Implement session mutation commands for explicit active exercise change, reorder, skip set, skip exercise, replace exercise, and add exercise with `sessionOnly` preservation in `packages/domain/src/workouts/session-mutation-commands.ts` [Trace: FR-040-FR-048, Data Model SessionExercise]
- [X] T098 [US4] Implement unknown exercise and alias confirmation flow during workout logging and session mutation in `packages/domain/src/exercises/unknown-exercise-flow.ts` [Trace: FR-014-FR-018h, FR-047]
- [X] T099 [US4] Implement permanent routine change request flow through structured `RoutineChange` union and confirmation before applying templates in `packages/domain/src/routines/routine-change-request-service.ts` [Trace: FR-049c-FR-049f, Contract ai-actions.md RoutineChange]
- [X] T100 [US4] Wire correction, deletion, session mutation, unknown exercise, and routine-change proposed actions into inbound message processing after deterministic pending-confirmation resolution and AI interpretation in `packages/persistence/src/postgres.ts` and `packages/persistence/src/us4.ts` [Trace: FR-036-FR-049f, PendingConfirmation, Contract ai-actions.md]
- [X] T101 [US4] Implement completed-history web editing UI and API integration in `apps/web/app/(product)/history/[workoutId]/page.tsx` and `apps/web/components/history/edit-workout-form.tsx` [Trace: FR-039d, FR-073-FR-074]

**Checkpoint**: Messy in-session behavior remains accurate, auditable, and scoped to the current session unless confirmed permanent.

**US4 scoped delivery (2026-10-07)**: T090-T101 are complete for the user's enumerated exercise/correction scope. Permanent exercise add/remove/replace/reorder is supported; `CHANGE_SESSION` and routine session-template mutation variants are deliberately not executed in this pass. Evidence: `tests/postgres/us4.test.ts`, `tests/e2e/us4/history-editor.spec.ts`, twelve US4 eval fixtures and the domain-policy tests above. The production path uses `PostgresVerticalSliceApp` plus transaction-bound `Us4Commands`; the in-memory processor remains a fast deterministic-slice test double. No later-story tasks were marked complete.

---

## Phase 9: User Story 5 - Previous Performance, PRs, And Rich Finish Context (Priority: P2)

**Goal**: The user sees concise target and previous-performance context, receives deterministic PRs when finishing, and gets richer summaries grounded in persisted data.

**Independent Test**: Start a returning workout, show exact comparable previous performance, log more sets, finish with completed or unfinished planned work choices, and verify deterministic summary and persisted history.

### Tests for User Story 5

- [X] T102 [P] [US5] Add previous-performance tests for exact confirmed exercise identity, confirmed alias, comparable unit/load semantics, no similar-exercise substitution, and no prior history in `packages/analytics/src/previous-performance-service.test.ts` [Trace: FR-025-FR-027d, CHK036]
- [X] T103 [P] [US5] Add personal-record tests for highest load, highest reps at same load, corrected data, soft-deleted exclusion, no estimated 1RM, and session-only substitution independent history in `packages/analytics/src/personal-record-service.test.ts` [Trace: FR-056-FR-057b, CHK037]
- [X] T104 [P] [US5] Add executable `eval-case.v1` fixtures for start intents, ambiguous starts, active-workout start, exact previous-performance lookup, no exact prior history, session-only change, permanent routine request, and ambiguous session-versus-permanent change in `packages/evals/fixtures/intent/us5-context-pr.yaml` [Trace: T078, T087, Contract eval-cases.md, FR-019-FR-027d, FR-049a-FR-049e]

### Implementation for User Story 5

- [X] T105 [US5] Implement previous-performance service using most recent exact confirmed exercise identity with compatible unit and load semantics only in `packages/analytics/src/previous-performance-service.ts` [Trace: FR-025-FR-027d, Data Model Derived Query Services]
- [X] T106 [US5] Implement personal-record service derived on demand from current valid `WorkoutSet` records with highest recorded load and highest reps at same load in `packages/analytics/src/personal-record-service.ts` [Trace: FR-056-FR-057b, Plan Analytics And PR Services]
- [X] T107 [US5] Add previous-performance context and deterministic PR summary formatting for WhatsApp in `apps/web/server/whatsapp/response-formatters.ts` [Trace: FR-025-FR-027, FR-051-FR-052]

**US5 implementation evidence (2026-10-07)**: T102-T107 and T075 are implemented. The PostgreSQL transaction-bound lifecycle lives in `packages/persistence/src/workout-lifecycle.ts`; pure completion policy and response formatting live in `packages/domain/src/workouts/completion-policy.ts` and `packages/domain/src/workouts/workout-response.ts`. `packages/persistence/src/workout-history-queries.ts` supplies owner-scoped current recorded sets to the pure analytics services. This also completes the production behavior behind T074/T076/T077: persisted completion choices, explicit completed/incomplete/continue/discard handling, deterministic duration/summary, idempotent finish results, snapshot details, and eligible-only cursor advancement. `0003_us5.sql` adds pending-choice state, exercise-name snapshots and a lookup index, not PR materialization. Migration backfill preserves the names available at upgrade; it cannot recover names already overwritten before snapshots existed. `tests/postgres/us5.test.ts` proves restart, corrections/deletions, aliases, no similar fallback, ownership and concurrent completion. `tests/e2e/us5/workout-lifecycle.spec.ts` exercises real HTTP auth/link/webhook/log/resume/finish/history; routine setup uses the existing repository API rather than adding a deferred US1 editor route. Ten executable US5 fixtures cover intent only; natural-language history execution remains US6. Normal tests use mock AI; Gemini does not derive metrics. All US6/US7 tasks remain deferred.

**Checkpoint**: Returning-workout context and deterministic PRs work without AI-generated metrics.

---

## Phase 10: User Story 6 - Review History, Analytics, And Bounded Questions (Priority: P2)

**Goal**: Users can review workout history and analytics on web and ask bounded WhatsApp questions answered only from persisted data.

**Independent Test**: After multiple workouts, review history/analytics on web and ask WhatsApp questions for last session, exact exercise last time, best set, weekly primary-muscle sets, last trained, monthly count, unsupported coaching, and missing data.

### Tests for User Story 6

- [x] T108 [P] [US6] Add analytics tests for workout frequency, completed workout count, monthly workout count, weekly primary-muscle set count, last-trained dates, custom uncertain exclusion, and corrected classification inclusion in `packages/analytics/src/workout-analytics-service.test.ts` [Trace: FR-061-FR-066d, Quickstart Analytics Validation]
- [x] T109 [P] [US6] Add history-question tests for last named workout/session, exact exercise last time, best set, ambiguous reference clarification, missing data safe response, and unsupported coaching boundary in `packages/analytics/src/history-question-service.test.ts` [Trace: FR-058-FR-060d, CHK039]
- [x] T110 [P] [US6] Add executable `eval-case.v1` fixtures for bounded history question, bounded analytics question, unsupported coaching request, unknown/unsupported intent, ambiguous reference, missing data, hallucination prevention, prompt injection attempts, and AI confidence not bypassing confirmation or validation in `packages/evals/fixtures/intent/us6-history-analytics-safety.yaml` [Trace: T078, T087, Contract eval-cases.md, FR-058-FR-060d, Constitution III-IV]
- [x] T111 [P] [US6] Add Playwright test for web history and analytics review in `tests/e2e/us6-history-analytics.spec.ts` [Trace: US6 Independent Test, SC-009]

### Implementation for User Story 6

- [x] T112 [US6] Implement workout analytics service for frequency, completed count, monthly count, last-trained dates, exercise progression, and primary-muscle weekly set counts in `packages/analytics/src/workout-analytics-service.ts` [Trace: FR-061-FR-066d, Data Model Derived Query Services]
- [x] T113 [US6] Implement history question service for bounded factual answers grounded in persisted data and safe limitation responses for unsupported questions in `packages/analytics/src/history-question-service.ts` [Trace: FR-058-FR-060d, Data Model HistoryQuestionService]
- [x] T114 [US6] Implement analytics API routes in `apps/web/app/api/analytics/overview/route.ts`, `apps/web/app/api/analytics/muscles/route.ts`, `apps/web/app/api/analytics/exercises/[exerciseId]/route.ts`, and `apps/web/app/api/history/questions/supported/route.ts` [Trace: Contract Analytics And History, FR-061-FR-066d]
- [x] T115 [US6] Build history list/detail page shells and API integration states in `apps/web/app/(product)/history/page.tsx` and `apps/web/app/(product)/history/[workoutId]/page.tsx` [Trace: FR-053-FR-055]
- [x] T115A [US6] Build analytics page shell and analytics components for overview, muscles, exercise progression, empty states, and ownership/error states in `apps/web/app/(product)/analytics/page.tsx` and `apps/web/components/analytics/*.tsx` [Trace: FR-061-FR-066d]
- [x] T116 [US6] Wire `QUERY_HISTORY` and `QUERY_ANALYTICS` actions into inbound processing with clarification for ambiguous references and no autonomous coaching decisions in `packages/domain/src/messaging/inbound-message-processor.ts` [Trace: FR-058-FR-060d, FR-077]

**Checkpoint**: History, analytics, bounded questions, and coaching boundary are deterministic and reviewable.

**US6 implementation evidence (2026-10-07)**: T108-T116 including T115A are complete. `packages/persistence/src/analytics-queries.ts` supplies owner-scoped repeatable-read web snapshots and transaction-bound inbound snapshots to the pure analytics/question services; the existing production dispatch remains in `packages/persistence/src/postgres.ts`, with deterministic parser exports in the planned domain messaging entry point. `0004_us6.sql` adds only the approved classification dependency, using user-private manual overrides through the already contracted classification PATCH route. UTC Monday weeks/calendar months and workout training dates are explicit; completed-only frequency/counts and valid completed/incomplete current-set progression/muscle counts exclude deleted, active and discarded data. Exact/confirmed alias history uses US5 compatible comparisons, never similar-exercise fallback. Safe query notation/coaching limitations bypass AI; other wording uses prompt v4/local envelope validation and deterministic values. Query clarification uses local text, never model-written factual claims. Fourteen executable US6 fixtures pass; all 71 fixtures pass across the suite. Node 22.23.3 validation: lint/typecheck/build/diff-check pass, 116 normal tests pass (38 PostgreSQL tests and one opt-in diagnostic skipped there), integration 23/23, vertical-slice e2e 2/2, eval 66 passed/one opt-in diagnostic skipped, real PostgreSQL 38/38 including nine US6 tests, Playwright desktop/mobile/auth/empty/error 3/3. Screenshots inspected at 1280px and 390px with no horizontal overflow. Normal AI tests use mocks, not live Gemini quality assertions. US7 and later hardening remain deferred; no coaching, materialization or additional infrastructure was added.

---

## Phase 11: User Story 7 - Control Stored Workout Data (Priority: P3)

**Goal**: Users can understand stored workout information, correct records, export workout data, and request account or workout-data deletion through a clear confirmed path.

**Independent Test**: A user reviews stored data, edits an incorrect record, exports workout data, requests deletion, confirms deletion, and receives a clear result without support intervention.

### Tests for User Story 7

- [x] T117 [P] [US7] Add data export tests for user-owned portable workout data, ownership isolation, and understandable shape in `packages/domain/src/data-controls/export-service.test.ts` [Trace: FR-073-FR-075, Contract Export And Deletion]
- [x] T118 [P] [US7] Add deletion confirmation and ownership-isolation tests for account deletion, workout-data deletion, user A cannot request deletion of user B data, user A cannot confirm user B deletion request, request ids cannot bypass ownership checks, deleted-user command blocking, idempotent repeated valid confirmation, and audit summary in `packages/domain/src/data-controls/deletion-service.test.ts` [Trace: FR-076, Data Model DataControlRequest, permanent/destructive mutation tests]
- [x] T119 [P] [US7] Add Playwright test for stored-data review, export request, delete request, and confirmation flow in `tests/e2e/us7-data-controls.spec.ts` [Trace: US7 Independent Test]

### Implementation for User Story 7

- [x] T120 [US7] Implement portable data export service for user-owned profile, WhatsApp link metadata, routines, exercises, aliases, workouts, sets, corrections, and analytics-relevant classifications in `packages/domain/src/data-controls/export-service.ts` [Trace: FR-073-FR-075, Data Model DataControlRequest]
- [x] T121 [US7] Implement confirmed account and workout-data deletion request service with audit summary and deleted-user command blocking in `packages/domain/src/data-controls/deletion-service.ts` [Trace: FR-076, Data Model User and DataControlRequest]
- [x] T122 [US7] Implement export and deletion API routes in `apps/web/app/api/data/export/route.ts`, `apps/web/app/api/data/export/[requestId]/route.ts`, `apps/web/app/api/data/delete-request/route.ts`, and `apps/web/app/api/data/delete-request/[requestId]/confirm/route.ts` [Trace: Contract Export And Deletion]
- [x] T123 [US7] Build stored-data review, export, and deletion UI in `apps/web/app/(product)/settings/data/page.tsx` and `apps/web/components/data-controls/*.tsx` [Trace: FR-073-FR-076]

**Checkpoint**: Data review, correction path, export, and deletion controls are user-owned and confirmation-gated.

**US7 implementation evidence (2026-10-07)**: T117-T123 are complete. The planned domain export/deletion services provide portable allowlists and deterministic confirmation policy; `packages/persistence/src/data-controls.ts` supplies the transaction-bound synchronous request service behind `PostgresVerticalSliceApp`. `0005_us7.sql` adds durable owner-scoped requests, owner/key uniqueness, one pending deletion, a storage-only soft-deletion marker, replay generation and approved active-account email uniqueness. Export snapshots include the approved structured categories but omit credentials, raw chat and unrelated operational records. Workout-data deletion preserves configuration and shared/global definitions while removing captured data from access through history, PRs, previous performance, analytics, bounded questions and new/old exports. Account deletion also tombstones the owner, invalidates sessions, revokes links and consumes unused link tokens. The exact original unexpired credential can replay only its completed account-deletion receipt; it never renews authentication or grants new data access. Ten-minute expiry, changed-target fingerprints, explicit confirmation and per-user transaction locks prevent stale, duplicate or concurrent destructive execution. Old webhook generations and web lifecycle keys cannot return removed facts or reapply them. No AI data-control interpretation, queue, worker or new retention commitment was added. Node 22.23.3/PostgreSQL 14.24: six domain tests, two new API validation integration tests, eight US7 PostgreSQL tests and three Playwright desktop/mobile/API tests pass. Full validation: lint/typecheck/build/diff-check pass, normal tests 124 passed/47 skipped (46 PostgreSQL cases executed separately plus one opt-in diagnostic), integration 25/25, vertical-slice e2e 2/2, offline eval 66 passed/one diagnostic skipped with 71/71 fixtures, PostgreSQL 46/46 and US7 Playwright 3/3. Screenshots reviewed at 1280px/390px with no horizontal overflow. Apply migration 0005 to existing databases before running; soft-deleted/audit records remain persisted and release privacy/retention/erasure policy remains open. T124 onward remains deferred.

---

## Phase 12: End-To-End Hardening, Security, And Data Controls

**Purpose**: Validate the whole product against quickstart scenarios, security boundaries, observability, retry lifecycle, AI eval gates, and constitution controls before review.

- [ ] T124 [P] Add full WhatsApp workout E2E test from account creation through analytics and PR review in `tests/e2e/core-validation-scenario.spec.ts` [Trace: Quickstart Core Validation Scenario, SC-001]
- [ ] T125 [P] Add broader end-to-end messaging replay hardening tests across webhook replay, duplicate webhook after outbound send, provider retry policy boundaries, linked identity routing, and full workout mutation recovery paths in `tests/integration/messaging/idempotency-retry.test.ts` [Trace: T058A, Messaging Deduplication, CHK029-CHK031]
- [x] T126 [P] Add security tests for authorization boundaries, deleted-user command blocking, raw chat logging minimization, secret absence from logs, and scoped rate limiting in `tests/integration/security/privacy-security.test.ts` [Trace: T024, T025, Constitution XII, Plan Security, FR-005, FR-073-FR-076]
- [x] T127 [P] Add no-scope-creep executable eval fixtures that reject autonomous programming, progression, deload, nutrition, medical, social, wearable, and trainer-marketplace requests in `packages/evals/fixtures/intent/out-of-scope.yaml` [Trace: T078, T087, FR-077, Constitution XIV]
- [x] T128 Run and document validation results for the selected package-manager commands equivalent to `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, and mandatory offline `eval` in `specs/001-whatsapp-workout-companion/validation-results.md` [Trace: Quickstart Expected Commands, Constitution X and XVIII]
- [x] T129 Review implementation traceability against `checklists/implementation-readiness.md` items CHK001-CHK044 and record unresolved risks in `specs/001-whatsapp-workout-companion/traceability-review.md` [Trace: Implementation Readiness Checklist, Constitution XVII]

**Hardening evidence (2026-10-07)**: T126-T129 complete; T124/T125 remain partial, deliberately unchecked. The release browser scenario passes signed webhook linking/logging/correction/custom confirmation/completion/history/analytics/derived PR review at desktop/mobile widths, but it sets up the hard-coded routine through the repository because approved onboarding/routine configuration is absent. Replay tests prove durable recovery, sender revalidation, concurrency, pending/sent record preservation and failure rollback, not actual WhatsApp delivery or outbound provider retry policy (T056 absent). Security hardening adds bounded local auth/session/inbound/AI limits, log allowlists, callback bounds/validation, production config checks, low-confidence clarification, positive-rep parsing, and 0006 ownership/context/numeric constraints plus indexes. No product feature or architecture expansion was added. Full evidence, every FR, unresolved earlier unchecked tasks and privacy release blockers are recorded in validation-results.md, traceability-review.md and release-readiness.md. Planning checklists remain unchanged; no new task IDs or second task file were created.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup And Technical Decisions**: No dependencies; T001-T003 must complete before workspace, persistence, or auth implementation depends on those choices.
- **Phase 2 Foundational**: Depends on Phase 1; blocks every user story and provides real auth, owner authorization, idempotency, confirmation handling, rate limiting, and observability.
- **US1**: Depends on Phase 2; establishes account, profile, routine, and WhatsApp token management only.
- **US2**: Depends on US1 account, link-token, routine, and exercise identity foundations; provides true inbound token consumption and provider identity linking before WhatsApp workout flows are called linked end-to-end.
- **US3**: Depends on US2 active workout creation, linked identity, messaging processor lifecycle, and T058A core idempotency integration passing.
- **Minimal Finish/History Vertical Slice**: Depends on US3 deterministic set history; validates finish and read-history without previous-performance, PR, analytics, or AI.
- **AI And Eval Infrastructure**: Depends on the minimal deterministic vertical slice; must complete before US4 AI-dependent conversational corrections/session mutations, US5 AI fixture execution, US6 bounded question interpretation, or any AI regression claim.
- **US4**: Depends on AI/eval infrastructure plus US3 recorded sets and active workout context.
- **US5**: Depends on minimal finish/history and US4 correction semantics for correction-aware PRs; previous-performance and PR services are outside the first usable vertical slice.
- **US6**: Depends on US5 history, PR, analytics query foundations, and AI/eval infrastructure for bounded WhatsApp questions.
- **US7**: Depends on US1 ownership and stored data surfaces from the vertical slice/US6.
- **Hardening**: Depends on all desired stories, AI eval wiring, observability, rate limiting, and retry lifecycle implementation.

### User Story Dependencies

- **User Story 1 (P1)**: MVP setup surface; no user-story dependencies after foundation.
- **User Story 2 (P1)**: Requires US1 account, link token, and routine; proves true inbound WhatsApp identity linking.
- **User Story 3 (P1)**: Requires US2 active workout.
- **Minimal Finish/History (P1)**: Requires US3 persisted set history; completes first usable vertical slice.
- **User Story 4 (P1)**: Requires US3 sets, session context, and AI/eval infrastructure.
- **User Story 5 (P2)**: Requires completed/corrected history; adds previous-performance and PRs after the minimal slice.
- **User Story 6 (P2)**: Requires completed/corrected history, analytics services, and AI/eval infrastructure.
- **User Story 7 (P3)**: Requires user-owned stored records and confirmation service.

### First Usable Vertical Slice

1. Complete Phase 1 and Phase 2.
2. Complete US1 tasks T030-T046.
3. Complete US2 tasks T047-T060, including T058A before US3 begins.
4. Complete US3 tasks T061-T071.
5. Complete minimal finish/history tasks T072-T077.
6. Validate with T073.

This proves only: create authenticated user -> create routine -> create short-lived WhatsApp link token -> consume it through the normalized inbound provider-scoped identity path -> start workout from the linked identity -> log deterministic sets -> finish workout -> persist/read history.

---

## Parallel Opportunities

- Phase 1 setup tasks T006-T008 can run after T001-T005 in parallel.
- Phase 2 schema, contract, messaging interface, and tests T012-T014 and T026-T027 can run in parallel after T011.
- US1 tests T030-T033 can be authored in parallel; exercise identity T040-T042 can run in parallel with routine service T043 after persistence schema exists.
- US2 link, routine sequence, workout state, and webhook security tests T047-T050 can run in parallel; adapters T055-T056 can run in parallel with domain start commands T051-T054, while T058A runs only after T058 exists and before US3.
- US3 parser, load-comparison, and active-context tests T061-T063 can run in parallel after T058A passes; load semantics T065 can run in parallel with parser T064 after schemas exist.
- Minimal finish/history tests T072-T073 can run in parallel after US3 behavior exists.
- AI/eval infrastructure T080-T084 can run in parallel where they touch prompts, provider adapter, and mock client separately; T079 depends on T078, and T085-T089 depend on those foundations.
- US4 correction, destructive-policy, session-mutation, and eval tests T090-T093 can run in parallel.
- US5 previous-performance, PR, and eval tests T102-T104 can run in parallel.
- US6 analytics, history-question, eval, and Playwright tests T108-T111 can run in parallel.
- US7 export, deletion, and Playwright tests T117-T119 can run in parallel.
- Hardening tests T124-T127 can run in parallel once all feature behavior exists.

---

## Parallel Examples

### User Story 1

```bash
Task: "T030 [US1] Add contract tests for auth/profile/link-token/routine/exercise endpoints in apps/web/tests/contract/us1-account-routine.contract.test.ts"
Task: "T031 [US1] Add domain tests for custom exercise identity, alias confirmation/reuse, alias conflict, similar-exercise no-auto-merge, and rename preserving identity in packages/domain/src/exercises/exercise-identity.test.ts"
Task: "T032 [US1] Add integration tests proving routine edits affect future templates only and completed snapshots are not rewritten in tests/integration/routines/routine-snapshots.test.ts"
Task: "T033 [US1] Add Playwright onboarding and routine-setup flow test in tests/e2e/us1-onboarding-routine.spec.ts"
```

### User Story 3

```bash
Task: "T061 [US3] Add deterministic parser unit tests for set notation in packages/domain/src/parser/set-parser.test.ts"
Task: "T062 [US3] Add multi-set and idempotency tests in packages/domain/src/workouts/log-set-command.test.ts"
Task: "T063 [US3] Add active-exercise sequencing tests in packages/domain/src/workouts/active-exercise-context.test.ts"
```

### AI And Eval Infrastructure

```bash
Task: "T078 Create eval case schema, loader, and pass/fail reporter in packages/evals/src/eval-case-schema.ts and packages/evals/src/runner.ts"
Task: "T080 Implement provider-independent AI interfaces and local error types in packages/ai/src/interfaces.ts"
Task: "T083 Implement one production structured-output provider adapter in packages/ai/src/providers/structured-output-client.ts"
Task: "T084 Implement mocked structured-output client in packages/ai/src/testing/mock-structured-output-client.ts"
```

### User Story 6

```bash
Task: "T108 [US6] Add analytics tests in packages/analytics/src/workout-analytics-service.test.ts"
Task: "T109 [US6] Add history-question tests in packages/analytics/src/history-question-service.test.ts"
Task: "T110 [US6] Add executable eval fixtures in packages/evals/fixtures/intent/us6-history-analytics.yaml"
Task: "T111 [US6] Add Playwright test in tests/e2e/us6-history-analytics.spec.ts"
```

---

## Implementation Strategy

### MVP First

1. Complete technical decisions, shared setup, and foundation.
2. Deliver US1 account, secure auth, token lifecycle, routine, and exercise identity.
3. Deliver US2 inbound provider identity linking, WhatsApp start, and active-workout safety.
4. Deliver US3 deterministic set logging.
5. Deliver minimal finish and persisted history tasks T072-T077.
6. Stop and validate the first usable vertical slice before adding previous-performance, PR, analytics, or AI-dependent behavior.

### Incremental Delivery

1. Add AI/eval infrastructure immediately after the first deterministic usable slice.
2. Add US4 correction and session mutation safety with AI-assisted interpretation behind deterministic validation.
3. Add US5 previous-performance and PR services.
4. Add US6 history, analytics, and bounded questions.
5. Add US7 export and deletion controls.
6. Finish with hardening, security, idempotency, observability, rate-limit, eval, and traceability validation.

### Scope Controls

- Do not introduce microservices, queues, PR materialization, event sourcing, extra AI agents, fake auth, auth stubs, or provider-specific domain logic.
- AI output remains advisory and schema-validated before deterministic command execution.
- Permanent, destructive, completed-history, identity-merge, and routine-change mutations remain confirmation-gated and at-most-once.
- Messaging mutations remain idempotent across duplicate delivery, retry, and crash-after-commit-before-outbound-send cases.
- Raw user chat and workout text are not logged by default.
