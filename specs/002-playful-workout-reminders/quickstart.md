# Validation and activation

1. Run `npm run lint`, `npm test -- --reporter=dot`, and `npm run check:ai-config`.
2. On an existing disposable `TEST_DATABASE_URL`, run the reminder, profile and WhatsApp transport PostgreSQL tests. Migration is applied by isolated test setup only.
3. Run the reminder preference browser test and check mobile/desktop persistence.
4. Optional for reminders outside the 24-hour chat window: obtain Meta approval for the exact copy in [contracts/reminders.md](contracts/reminders.md), then configure the approved name/language in the deployment environment.
5. With explicit approval, apply the new migration to the application database. Enable reminders in Profile & preferences, set the desired time zone and routine planned days, and verify WhatsApp ownership/consent.
6. Run a read-only dry run. Activate `npm run reminders:worker` under the deployment's process supervisor. It must remain running; closing a terminal stops an unsupervised worker.

No template approval is needed for the initial in-window version. Without a template, a user message is needed to reopen the window after 24 hours. No real WhatsApp messages are sent by the automated tests. Production activation is separate from code readiness.

## Verification evidence — 2026-10-29

| Check | Command | Result |
|---|---|---|
| Local gate | `npm run verify` | Passed: AI configuration check, TypeScript lint, 479 offline tests. 234 database-gated cases skipped in this default invocation. |
| Disposable PostgreSQL | Vitest for reminder, configuration, ownership, transport, US4, US5, US6 suites with `TEST_DATABASE_URL` | 87 passed across 7 files; no application database migration executed. |
| Browser | `npm run test:reminders:web` with disposable database | 2 passed, at 1280px and 390px. Preference saved/reloaded/disabled; no overflow. |
| Build | `NEXT_TEST_DIST_DIR=.next-reminder-tests npm run build` | Passed after the framework's advisory interruption. Existing Next.js security advisory remains; upgrade is separate work. |
| Worker CLI | `npm run reminders:run` with offline configuration and disposable schema | Preview returned zero queued/sent messages; no writes or provider calls. |
| Final types | `npm run lint` after restoring default generated dev-type references | Passed. |

The browser build uses an isolated directory because the user's development server is already running. No existing server was stopped. No AI prompt/intent changes were made, and no live Gemini/Meta calls or live reminder worker were run. The initial database failure exposed that migrations use an explicit registration list; migration 0012 is now registered and both fresh/upgrade suites pass.

## Activation state

Code and validation are complete on `002-playful-workout-reminders`. Reminders are **not active** in the application yet: the application migration and worker activation await explicit approval under the repository's `AGENTS.md`. Once deployed, users opt in under Profile & preferences and choose routine training days. A template is optional and is not a prerequisite for the initial version.
