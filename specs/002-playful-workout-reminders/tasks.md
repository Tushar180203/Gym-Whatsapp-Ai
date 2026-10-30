# Tasks: Playful replies and morning reminders

Input: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts](contracts/reminders.md).

## Setup and foundation

- [X] T001 Record spec, research, plan, data model, contracts and validation in `specs/002-playful-workout-reminders/`.
- [X] T002 Add profile preference and outbound template/expiry metadata in `packages/persistence/migrations/0012_workout_reminders.sql` and validated contracts in `packages/contracts/src/`.

## US1 — Playful replies

Independent test: all factual response types render with one icon, suitable celebration and no duplicate decoration or false success.

- [X] T003 [US1] Add deterministic icons/motivation in `packages/domain/src/messaging/response-layout.ts` and exact presentation regressions.

## US2 — Morning reminder

Independent test: a due enabled user gets one dated intent and a correct approved-template payload without a workout mutation.

- [X] T004 [US2] Implement time/day/plan selection and approved copy in `packages/domain/src/reminders/morning-reminder.ts` with boundary tests.
- [X] T005 [US2] Implement owner-locked deduplicated queueing in `packages/persistence/src/workout-reminders.ts` with disposable database tests.
- [X] T006 [US2] Add validated template sending and expiry/opt-out checks in `packages/messaging/src/` with mocked provider and delivery tests.
- [X] T007 [US2] Add dry-run/once/watch runner in `scripts/workout-reminders.ts`, commands in `package.json`, and safe config examples in `.env.example`.

## US3 — User control

Independent test: preference survives reload, is exported, and disabling blocks a queued reminder.

- [X] T008 [US3] Persist/export preference through `packages/persistence/src/configuration.ts`, `postgres.ts` and `packages/domain/src/data-controls/export-service.ts`.
- [X] T009 [US3] Add reminder checkbox and local-time explanation to `apps/web/components/routines/setup-view.tsx` and browser regression coverage.

## Verification and handoff

- [X] T010 Run required offline, configuration, PostgreSQL and browser checks; record results in `specs/002-playful-workout-reminders/quickstart.md`.
- [ ] T011 Obtain explicit production migration/worker activation approval (template approval is optional for later extended delivery); report actual activation state.

Dependencies: T001 → T002 → T004 → T005 → T006 → T007. T003 is independent. T008 follows T002; T009 follows T008. T010 follows code completion; T011 is deployment. Tone can ship independently as the first slice. Independent work opportunities: T003 vs T004, provider contract tests vs UI tests; implementation in this session is sequential in the shared checkout.
