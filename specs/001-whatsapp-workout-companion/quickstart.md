# Quickstart: Plan Validation Guide

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
