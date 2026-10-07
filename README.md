# Gym-Whatsapp-Ai

## Deterministic Vertical Slice

This repository currently implements the first deterministic WhatsApp workout companion slice:

1. Create an authenticated user.
2. Set a preferred weight unit.
3. Create a routine with planned exercises.
4. Generate and consume a short-lived WhatsApp link token through a normalized inbound message.
5. Start a workout from the linked identity.
6. Log deterministic set notation.
7. Finish the workout.
8. Read persisted workout history.

### Local Commands

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
```

Use Node 22 LTS (`.nvmrc`). Production routes require `DATABASE_URL` and use PostgreSQL; the in-memory repository is only a fast test double.

## US5: Context, Records And Completion

Previous performance uses the latest completed/incomplete occurrence of the exact exercise identity (or confirmed alias), with the same unit and load semantics. PRs are calculated on demand from current non-deleted sets; no PR table or estimated 1RM exists.

`start` shows concise exercise targets and prior performance. `resume` keeps the same workout and exercise. `done` completes fully recorded/skipped work; partial workouts ask for `save completed`, `save incomplete`, `continue`, or `discard`. Empty workouts cannot be saved completed. Off-sequence, incomplete and discarded workouts do not advance the cursor.

Apply `packages/persistence/migrations/0003_us5.sql` once to an existing database already migrated through `0002_us4.sql` before starting the updated runtime. The application's `migrate()` method tracks and applies migrations for integration tests/new managed databases. This migration persists pending finish choices and exercise-name snapshots; it does not persist PRs.

```bash
# Use a disposable test database; tests reset public tables and isolated test schemas.
TEST_DATABASE_URL=postgresql://user@localhost:5432/workout_test npm run test:postgres
TEST_DATABASE_URL=postgresql://user@localhost:5432/workout_test npm run test:us5:e2e
npm run eval
npm run build
npm run dev
```

HTTP finish accepts `{ "idempotencyKey": "unique-request-key", "requestedCompletion": "COMPLETE" }` (or `INCOMPLETE`, `CONTINUE`, `DISCARD`); omit the completion choice to request finish. Discard outside a pending finish choice asks for confirmation: submit a new request key to confirm, not a retry of the proposal key. Normal tests require no AI key or network; live Gemini evaluation remains opt-in.

## US6: History And Analytics

`/history` reviews saved completed/incomplete workouts and their snapshot details. `/analytics` provides Overview, Muscles and Exercises views. All values derive on demand from owner-scoped current recorded sets and saved workouts; corrections/deletions are reflected on the next read. No aggregate or PR cache exists.

Calendar periods are UTC: Monday-start weeks and calendar months. Frequency and workout counts include COMPLETED sessions only. Muscle sets/progression/last-trained include recorded sets in COMPLETED or INCOMPLETE sessions; active/discarded sessions and deleted sets are excluded. Training dates use workout start time, never a later correction timestamp. Only manually confirmed PRIMARY classifications contribute whole muscle sets. Uncertain/unclassified/secondary rows do not contribute. The minimal classification editor makes no suggested classification; classification overrides are private to the authenticated user.

WhatsApp supports last named session, exact exercise last-time/best, weekly muscle sets, last-trained and monthly completed counts. Confirmed aliases resolve to exact identities; ambiguous references clarify, unavailable records never fall back to similar exercises. Best/last-time comparisons reuse US5's compatible preferred unit and identity load semantics. Coaching requests return a limitation, not a training prescription. Safe question notation bypasses Gemini; other wording uses locally validated intent/subject proposals only, never model-generated metrics or factual answers.

Apply `packages/persistence/migrations/0004_us6.sql` once to an existing database migrated through `0003_us5.sql` before running US6. New managed databases use `migrate()` to apply all four migrations. Use a disposable database for these tests:

```bash
TEST_DATABASE_URL=postgresql://user@localhost:5432/workout_test npm run test:postgres
TEST_DATABASE_URL=postgresql://user@localhost:5432/workout_test npm run test:us6:web
```

The 14 US6 eval fixtures use the mock client. Live Gemini quality evaluation remains opt-in. US7 is implemented below; final hardening evidence is linked under Release Review.

## US7: Stored Data, Export And Deletion

`/settings/data` shows stored-data category counts, the existing history correction path, export requests/status/downloads and explicit workout-data/account deletion confirmations. Export is an owner-only synchronous JSON snapshot (`workout-export.v1`) with profile/preferences, link metadata, routines/cursors/templates/planned exercises, exact identities/aliases/classifications, sessions/exercises/sets/corrections and completion metadata. Credentials, raw chat, tokens, provider secrets and operational records are excluded.

Deletion proposals expire after ten minutes; target changes make confirmation stale. Owner/key uniqueness and the existing per-user transaction lock make requests, concurrent confirmations and retries idempotent. Workout-data deletion soft-deletes recorded sessions/sets and removes their access through history, PR, previous-performance, analytics, bounded questions and export. Configuration stays available. Old exports are revoked and old message replays cannot return removed facts. Account deletion also persists the user tombstone, invalidates sessions, revokes links and consumes outstanding link tokens. Only the exact original-session completed account-deletion receipt can replay; it grants no renewed session or data access.

Use `npm run db:migrate` to apply the ordered migrations through `0006_release_integrity.sql`; do not reapply SQL manually after it is recorded in the ledger. Soft-deleted/audit records remain persisted; physical erasure, backup handling and retention/privacy commitments are not promised by this implementation and still require release decisions. Requests/audit summaries contain IDs, operation/status, timestamps and counts, not unnecessary sensitive payloads. Gemini does not decide or execute data controls.

```bash
# Disposable test database only: these suites reset tables/test schemas.
TEST_DATABASE_URL=postgresql://user@localhost:5432/workout_test npm run test:postgres
TEST_DATABASE_URL=postgresql://user@localhost:5432/workout_test npm run test:us7:web
```

US7 evidence describes that implementation pass. See Release Review for subsequent hardening and unresolved release blockers.

## Release Review

Hardening evidence and unresolved release blockers are in
`specs/001-whatsapp-workout-companion/validation-results.md`,
`traceability-review.md`, and `release-readiness.md` in that directory.
Run `npm run db:migrate` before serving an upgraded database; migration 0006 adds
ownership/context integrity constraints. `npm start` checks production configuration.
The repository is ready for human review, not public production sign-off.
