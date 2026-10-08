# Quickstart: Plan Validation Guide

## Domain Conversation Validation

Use Node 22 and apply ordered migrations through `0010_conversation.sql` with `npm run db:migrate` before running the updated application. Existing users/workouts safely initialize conversation state on their next verified inbound message.

```bash
npm run test:conversation
# TEST_DATABASE_URL must point to a disposable test database, never the application database.
npm run test:conversation:postgres
npm run test:postgres
npm run eval
```

The PostgreSQL suite executes twenty semantic scenario families plus long messy conversation, nested clarification, short answers, cancellation/stale/replay/restart/foreign-target and upgrade tests. Fixtures assert state and forbidden mutations rather than exact conversational copy. Mock-provider tests require no key/network access; live provider commands remain opt-in. Missing or unsupported intent gets contextual recovery, not a generic action error. No Phase C policy changes are implied.

## Self-Service WhatsApp Ownership

Apply migrations through 0009 before using number verification. Set public `WHATSAPP_BUSINESS_NUMBER` to the actual business WhatsApp destination in E.164 (not the phone-number ID); existing Meta secret, signature and recipient-encryption configuration remains unchanged. No real credentials belong in .env.example.

On `/onboarding` or `/routines`, enter an international number, explicitly opt in to workout messaging, and choose Verify on WhatsApp. Open WhatsApp uses a configured wa.me destination with `LINK <code>`. Send from the entered account within ten minutes. Only authenticated matching sender proof makes the status WhatsApp connected; typed numbers never establish recipients. Reload preserves pending status, not the code; choose Generate new verification explicitly if needed. To change a verified number choose Change WhatsApp number, prove the new number, and only then is the old link disconnected. Disconnect WhatsApp requires explicit confirmation.

Run `TEST_DATABASE_URL=postgresql://LOCAL_TEST_DATABASE npm run test:whatsapp:ownership` for database/API ownership, replay/concurrency, rollback and populated migration coverage; `npm run test:whatsapp:transport` includes real application HTTP APIs -> signed webhook -> controlled provider -> workout completion. Run `npm run test:whatsapp:web` with the same test database for real desktop/mobile onboarding and number change/disconnect. Normal acceptance is offline: signed fixtures/fake provider, no live Meta/Gemini credentials or messages. See [ownership design](whatsapp-ownership-verification.md) for trust boundaries and bounded request/manual notification delivery.

## Phase B Transport Validation

Apply ordered migrations through 0008 before enabling `WHATSAPP_PROVIDER=cloud_api`. Configure the placeholder variables in .env.example through server-only secrets. Run `TEST_DATABASE_URL=postgresql://LOCAL_TEST_DATABASE npm run test:whatsapp:transport` for signed HTTP application -> PostgreSQL -> controllable provider acceptance, including replay/retry/restart. Normal tests require no live credentials. Operator report/retry and the deliberately opt-in, manually initiated live smoke are documented in [phase-b-transport.md](phase-b-transport.md). No historical false SENT record is automatically replayed; no Phase C decision is implied.

This guide describes the validation scenarios the implementation should eventually support. It is not an implementation task list and does not include source code.

## Prerequisites

- Node.js LTS 22.x.
- PostgreSQL.
- Environment variables for database, auth secrets, WhatsApp Cloud API credentials, webhook verification secret, AI provider credentials, and app URL.
- Test WhatsApp Business Platform setup for webhook verification and sandbox/manual test messages.

## Expected Commands

Exact scripts will be created during implementation. Planned command surface:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm eval
pnpm dev
```

## Core Validation Scenario

End-to-end happy path:

1. Create an account.
2. Configure preferred weight unit.
3. Create a routine with at least two named session templates.
4. Add known and custom exercises with planned sets and rep targets.
5. Connect WhatsApp through a short-lived link token.
6. Send `start` from the linked WhatsApp identity.
7. Confirm the proposed next workout from the user's explicit routine sequence progress/cursor.
8. Log `45x10`, `45x9`, and `same x 8` against the active exercise.
9. Correct one set with `that was 44 not 45`.
10. Send `bench is busy let's do shoulder press first`.
11. Add an unknown exercise and confirm custom identity or alias.
12. Finish the workout.
13. Review completed history on web.
14. View analytics and PR output.

Expected outcome:

- One active workout exists during the session.
- Set history preserves exercise identity, order, load, unit, load semantics, reps, and correction state.
- Set logging does not auto-advance active exercise.
- Session-only changes do not edit the routine.
- Completed off-sequence workouts do not implicitly redefine the routine sequence cursor unless the workout was intended to advance normal sequence progress.
- Completed session appears in history and analytics.
- PR and previous-performance values are deterministic.

## Deterministic Parser Validation

Inputs that should avoid AI when context is safe:

- `45x10`
- `45 kg x 10`
- `45 each 10`
- `45kg for 10`
- `45x10, 45x9, 45x8`
- `same x 9` when a previous comparable set exists

Expected outcome:

- Parsed action is `LOG_SET` or `LOG_MULTIPLE_SETS`.
- Missing unsafe fields ask for clarification.
- Preferred unit is used only when safe.
- `each` maps to `PER_HAND_PER_SIDE`.

## Ambiguous AI Interpretation Validation

AI infrastructure regression gate: run `npx -y node@22 --run eval` before accepting
prompt, schema, model, or interpreter changes. This runs the offline mock-provider
fixtures and boundary tests with a pass/fail report; it measures contract behavior,
not live model accuracy. Normal tests require no API key or network.

For an opt-in Gemini adapter smoke test, configure `AI_PROVIDER=gemini`,
`GEMINI_API_KEY`, and `AI_MODEL=gemini-3.5-flash-lite`, then run
`npx -y node@22 --run eval:real-provider`. The default model is `gemini-3.5-flash-lite`;
`AI_MODEL` overrides it. Use an unbilled free-tier project and synthetic test data;
quotas and data-handling terms are documented in research.md. OpenAI is optional
future work, not a required key or paid fallback. The smoke test validates extracted fields, and failure
fails the command. Live model quality remains unverified until this is run.

The runtime now dispatches the scoped US4 correction, exercise/session mutation,
custom identity/alias and permanent exercise-template actions. Pending yes/confirm
and no/cancel resolution runs before interpretation. Later-story history questions,
PRs, analytics and coaching execution remain deferred.

### US4 Verification And Local History Editor

Use Node 22 and an isolated PostgreSQL test database; the PostgreSQL tests recreate
their test tables/schemas, so do not point `TEST_DATABASE_URL` at production data.

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
npm run eval
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/workout_test npm run test:postgres
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/workout_test npm run test:us4:web
```

The browser command starts/stops its own Next.js server on port 3104, uses a
synthetic provider key without live calls, and writes desktop/mobile screenshots
under ignored `test-results/`. It defaults to `/usr/bin/google-chrome`; set
`CHROME_PATH` for a different installed Chromium browser.

For manual use, configure `DATABASE_URL`, `AI_PROVIDER=gemini`, `GEMINI_API_KEY`,
`AI_MODEL`, `WHATSAPP_APP_SECRET` and the deployed `APP_ORIGIN`. Apply migrations
through `PostgresVerticalSliceApp.migrate()` before serving; it now tracks applied
migrations and adopts an existing 0001 database. Export environment variables in
the server process (the root `.env` is not automatically loaded by Next's app-dir
server), then run `npm run dev`. `/history/:workoutId` edits an owned completed or
incomplete workout. Authentication uses the existing signup endpoint's HttpOnly
session cookie; no new login/onboarding UI is included in US4.

US4 scenarios: `actually that was 9`, `incline set 2 was actually 10`,
`delete last set`, `do Squat first`, `skip Squat today`,
`replace incline with Squat` followed by `today only` or `update my routine`,
`add Red chest machine today` followed by confirmation, and explicit destructive
commands `delete exercise <exact-name>`, `delete workout <owned-id>` or
`delete history all`. Protected proposals expire after ten minutes and fail safely
when their versioned targets change. Broad date-based history deletion requests
that cannot be uniquely resolved ask for more precise targets.

Inputs that may use AI:

- `bench is busy let's do shoulder press first`
- `that red hammer machine instead today`
- `actually set 2 was 11`
- `replace incline with machine press`
- `what did I incline press last time?`
- `should I deload?`

Expected outcome:

- AI returns structured proposed action only.
- Domain validation determines whether to execute, ask, or decline.
- Coaching questions return bounded recorded facts or safe limitation text, not autonomous programming.

## Concurrency And Idempotency Validation

Scenarios:

- Replay the same WhatsApp webhook payload.
- Send duplicate confirmation for the same pending action.
- Send two set messages concurrently during one active workout.
- Retry a multi-set message after one set was already created.

Expected outcome:

- No duplicate inbound message processing.
- No duplicate sets.
- Confirmation applies at most once.
- Stale workout versions ask for refresh or clarification.

## Correction And Destructive Safety Validation

Scenarios:

- Active workout: `delete last set` with a single clear last set.
- Active workout: `actually that was 9` when multiple targets are plausible.
- Completed workout: edit a past set through WhatsApp.
- Web: edit completed workout history.
- Delete an entire workout.
- Request a permanent routine change from WhatsApp.

Expected outcome:

- Unambiguous active last-set delete may execute directly.
- Ambiguous corrections ask for clarification.
- Completed-history WhatsApp edits require confirmation.
- Destructive and permanent actions require confirmation.
- Analytics and PRs recalculate after applied corrections.

## Analytics Validation

Scenarios:

- Weekly chest set count with confirmed primary-muscle exercises.
- Custom exercise with uncertain classification.
- Correct custom exercise classification.
- Monthly workout count.
- Last trained muscle/session.
- Exercise progression over multiple completed sessions.

Expected outcome:

- Primary-muscle sets only.
- Secondary muscles do not contribute.
- Uncertain custom exercises are excluded until confirmed.
- Corrected classification changes future analytics.
- No values are invented or model-generated.

US6 executable validation: `TEST_DATABASE_URL=<disposable-postgres-url> npm run test:postgres` covers restart, current corrected/deleted records, classification changes and ownership. `TEST_DATABASE_URL=<disposable-postgres-url> npm run test:us6:web` covers desktop/mobile history and Overview/Muscles/Exercises views, manual classification, empty/error/auth states. Apply `0004_us6.sql` after `0003_us5.sql` on existing databases first. Periods are explicitly UTC (Monday weeks/calendar months); counts/frequency include completed sessions only, while valid recorded sets in completed/incomplete sessions contribute muscle sets/progression/last-trained. Classifications are user-private confirmed PRIMARY values, never guessed. Supported WhatsApp examples above use deterministic query routing; differently worded queries use validated Gemini intent only. Offline eval fixtures test boundaries, not live-model accuracy.

## US7 Data-Control Validation

Apply `0005_us7.sql` after `0004_us6.sql` on existing databases. With a disposable PostgreSQL database, run `TEST_DATABASE_URL=<url> npm run test:postgres` and `TEST_DATABASE_URL=<url> npm run test:us7:web` under Node 22. The web surface is `/settings/data`; ordinary review/correction continues through `/history`.

Verify portable owner-only JSON categories, no credentials/raw-chat/operational secrets, export status and download; cross-user export/deletion/confirmation rejection; explicit deletion consent; stale/expired no-op; repeated/concurrent confirmation no-op after completion; restart-safe status; active/completed data removal from history/PRs/previous performance/analytics/questions; other users/shared definitions intact; revoked export snapshots and old webhook replay protection; invalidated sessions/links after account deletion. Only the original unexpired session can replay its exact completed account-deletion receipt without renewing access. No AI interpretation is used. Deletion implements soft inaccessibility, not a new retention or physical-erasure commitment.

## Webhook Security Validation

Scenarios:

- GET webhook verification succeeds with valid challenge inputs.
- POST webhook rejects invalid signature.
- Unlinked WhatsApp identity sends workout-affecting message.
- Linked identity sends normal workout message.

Expected outcome:

- Invalid webhooks do not enter application processing.
- Unlinked messages cannot mutate workout state.
- Logs contain safe identifiers and error categories, not unnecessary raw chat content.
