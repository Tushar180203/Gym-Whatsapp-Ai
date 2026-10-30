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

`npm run dev` loads the root `.env` and validates configuration before starting the server. Explicit environment variables override local defaults. Keep the live application's database separate from `TEST_DATABASE_URL`: acceptance suites reset their disposable database. Use `npm run dev -- --port 3001` when another app uses port 3000.

The opt-in conversation scale evaluation uses real Gemini interpretation, signed
webhooks, synthetic users in an isolated test schema, and fake outbound delivery.
It checks relevant replies and exact database effects after each turn, including
missing-value replies, confirmations, corrections and duplicate messages. With
`SCALE_VARIANTS=80` it runs 2,640 scenarios across 33 families. It requires a
disposable `TEST_DATABASE_URL`; it never uses the live `DATABASE_URL` for writes.

```bash
RUN_SCALE_CONVERSATION_EVAL=1 SCALE_VARIANTS=80 TEST_DATABASE_URL=postgresql://USER@localhost:56432/workout_flow_test \
  node --env-file=.env node_modules/vitest/vitest.mjs run tests/postgres/conversation-scale.test.ts --maxWorkers=1 --minWorkers=1
```

Results, individual replies, AI proposals and write evidence are saved under
`specs/001-whatsapp-workout-companion/evaluation-runs/user-scale/`. Generate a
reviewable report with `node scripts/report-conversation-scale.mjs RUN_DIRECTORY`.
`SCALE_INTERPRETER=controlled` supplies authored intents for a separate backend
audit; those results do not measure AI understanding. Provider errors never count
as passing real-AI interpretation cases merely because no data changed.

The current audit has a quota-aware worker in
`scripts/autoresume-conversation-scale.mjs`. It checkpoints daily Gemini quota
exhaustion, preserves already passing cases, and resumes outstanding cases after
the provider's reset time. Its current state is recorded in
`evaluation-runs/user-scale/automatic-resume.json` under the feature spec directory.
The worker needs this machine and the local test PostgreSQL instance to remain up.

## US5: Context, Records And Completion

Previous performance uses the latest completed/incomplete occurrence of the exact exercise identity (or confirmed alias), with the same unit and load semantics. PRs are calculated on demand from current non-deleted sets; no PR table or estimated 1RM exists.

`start`, `let's start`, `gym time`, and `start workout` propose the next cursor-selected workout with its full plan. `start planned` explicitly accepts it. `choose Lower today` proposes an alternative; `rest` dismisses a proposal without changing progression. `resume` preserves an active workout but cannot activate a proposal. `done` completes fully recorded/skipped work; partial workouts ask for `save completed`, `save incomplete`, `continue`, or `discard`. Empty workouts cannot be saved completed. Off-sequence, incomplete and discarded workouts do not advance the cursor.

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

Use `npm run db:migrate` to apply the ordered migrations through `0007_core_configuration.sql`; do not reapply SQL manually after it is recorded in the ledger. Soft-deleted/audit records remain persisted; physical erasure, backup handling and retention/privacy commitments are not promised by this implementation and still require release decisions. Requests/audit summaries contain IDs, operation/status, timestamps and counts, not unnecessary sensitive payloads. Gemini does not decide or execute data controls.

```bash
# Disposable test database only: these suites reset tables/test schemas.
TEST_DATABASE_URL=postgresql://user@localhost:5432/workout_test npm run test:postgres
TEST_DATABASE_URL=postgresql://user@localhost:5432/workout_test npm run test:us7:web
```

US7 evidence describes that implementation pass. See Release Review for subsequent hardening and unresolved release blockers.

## Phase A Self-Service Setup

Apply ordered migrations with `npm run db:migrate`, then open `/onboarding` to create an account, save preferred unit/display name, and configure named routines, sessions, known/confirmed custom exercises, planned sets/reps/order and frequency/days. `/routines` manages saved configuration, aliases/rename, link tokens and workout proposal/selection. Explicit replacement requires confirmation; permanent sequence reorder revalidates versions and preserves the next cursor identity and historical snapshots.

Use `TEST_DATABASE_URL=postgresql://user@localhost:5432/workout_test npm run test:phase-a:web` for actual UI/API onboarding and selection acceptance. The database must be disposable. Signed inbound fixtures prove identity linking and workout behavior without live Meta calls; actual outbound delivery and GET verification remain Phase B work. Existing authenticated sessions work; no new returning-user password sign-in scope was added.

## Release Evidence

Hardening evidence and unresolved release blockers are in
`specs/001-whatsapp-workout-companion/validation-results.md`,
`traceability-review.md`, and `release-readiness.md` in that directory.
Run `npm run db:migrate` before serving an upgraded database; migration 0006 adds
ownership/context integrity constraints. `npm start` checks production configuration.
The repository is ready for human review, not public production sign-off.

### Conversation memory and local dates

Run `npm run db:migrate` before starting this version. Profiles now store an IANA timezone and a chat-memory preference. New browser signups save the device timezone; existing accounts use UTC until the user saves a timezone in Profile & preferences. Weekly and monthly totals use that calendar.

The companion stores sanitized, timestamped user/assistant turns separately from recorded workout facts. It supplies the latest 24 messages to the interpreter and can retrieve up to 200 messages within the previous 30 days for earlier-chat questions. It cannot recover chat text from before this feature: legacy inbound text remains redacted. Verification codes and credential-bearing messages are excluded; email addresses and international phone numbers are redacted. Old chat is untrusted context and cannot supply new set numbers or confirmations.

Turning memory off and saving clears chat memory. Exports include unexpired chat memory; account/workout-data deletion clears it. Expired entries are excluded from reads and exports immediately, and are removed when the next authenticated workout message is processed. Schedule `npm run memory:prune` daily with `DATABASE_URL` configured to purge expired rows for inactive accounts too. The command does not print message contents.

## AI-Assisted Development

This repo is built with AI coding agents (Codex, Claude Code, GitHub Spec Kit) under enforced guardrails.

- Agent instructions: [AGENTS.md](AGENTS.md) (canonical; `CLAUDE.md` imports it). Architecture: [docs/architecture.md](docs/architecture.md).
- Policy, owners, data rules: [docs/ai-policy.md](docs/ai-policy.md). Setup: [docs/ai-onboarding.md](docs/ai-onboarding.md). Decisions: [docs/adr/](docs/adr/README.md).
- Guardrails: `.claude/settings.json` + `.claude/hooks/`, `.codex/config.toml`, git hooks in `.githooks/` (enabled by `npm ci`), CI in `.github/workflows/`.
- Before opening a PR: `npm run verify`. AI-assisted commits carry a `Co-Authored-By:` trailer and PRs the `ai-assisted` label.

## Playful replies and 5 AM reminders

WhatsApp replies use icons and brief encouragement, including “Yeahh buddy, let's gooo!” at workout start. In **Profile & preferences**, users can opt into a 5:00 AM reminder in their saved time zone. Choose planned weekdays in the routine and verify WhatsApp first. Rest days, active workouts, recorded early training, opt-outs and duplicate worker ticks are skipped.

No Meta template approval is needed for the initial version: reminders send only within 24 hours of the user's last WhatsApp message. After that, they pause until the user messages again. Optional approved-template configuration can extend delivery; see [the reminder contract](specs/002-playful-workout-reminders/contracts/reminders.md).

The feature needs migration `0012_workout_reminders.sql` and a running worker. With deployment environment variables supplied by the operator/supervisor, `npm run reminders:run` is a read-only preview, `npm run reminders:run -- --send` sends one tick, and `npm run reminders:worker` checks every 30 seconds. Do not start live delivery or apply the application migration until explicitly approved. Automated tests use disposable databases and mocked delivery.

[Specification, validation and activation steps](specs/002-playful-workout-reminders/quickstart.md).
