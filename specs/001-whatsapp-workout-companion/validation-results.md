# Release Validation Results

## Domain Conversation Orchestration (2026-10-08)

Approved robustness extension only; T130-T135. Node 22.23.3, PostgreSQL 14.24. Existing ownership/transport worktree changes and local secrets preserved. No live Gemini/Meta calls, new agents, queues, transcript retention or Phase C decisions.

| Validation | Final result |
|---|---|
| npm run lint | PASS (existing TypeScript-based lint command) |
| npm run typecheck | PASS |
| npm run test | 255 passed; 138 intentionally skipped (137 PG cases executed separately, one opt-in diagnostic) |
| npm run test:integration | 54/54 passed |
| npm run test:e2e | 2/2 fast vertical-slice cases passed |
| npm run eval | 79 passed, one opt-in diagnostic skipped; 89/89 eval-case.v1 fixtures passed |
| npm run test:conversation | 72/72 passed, including 336 generated lifting grammar variants |
| npm run test:postgres | 137/137 passed across 12 files |
| npm run test:conversation:postgres | 33/33 passed: 20 scenario families and 13 extended regressions |
| Long messy conversation | PASS, 23 turns; exact corrected persisted reps [10,8,15,15]; no routine mutation; zero AI calls |
| Restart / replay / older events | PASS: typed parent/child and numeric repair survive restart; concurrent duplicate confirmation applies once; older event leaves state unchanged |
| AI failure / no-AI / prompt injection | PASS: local invalid output and false safety flag cannot mutate; permanent change still confirms; common lifting/facts/social bypass AI |
| npm run test:whatsapp:web | 2/2 actual UI/API controlled-provider cases passed at 1280px and 390px |
| Fresh migrations | All ten migrations apply to empty test schemas, including fresh vertical-slice database tables; ordered ledger/rerun tests pass |
| Populated upgrade | PASS: removing only 0010/state ledger entry, rerunning migrations preserves existing workout/sets and safely creates missing conversation state |
| Local runtime migration | 0010 applied using existing privately preserved configuration; developer server restored on port 3110 |
| npm run build | PASS under NODE_ENV=production |
| Secret/privacy scan | 329 repository files; zero configured-secret/private-key matches; no staged files; .env ignored and untracked |
| git diff --check | PASS |

Twenty semantic families executed 96 user turns with two mock-provider calls (2.1%; 97.9% deterministic bypass). This is measured fixture coverage, not a promise about all real-world language. Seven new provider-independent fixtures bring the executable eval total from 82 to 89. Live model quality was not evaluated.

Invariants cover one active workout, unchanged permanent templates for session-only changes, protected permanent confirmation, no ambiguous/foreign-target mutation, duplicate-command at-most-once behavior, read-only facts/greetings, AI failure without workout mutation, and nested parent preservation. Missing reps/load, malformed references, ambiguous field repair, stale targets and unsupported compounds recover without fabricated data. Exact identity lookup remains owner-scoped beyond the bounded prompt list; newest-set context and exact current-exercise counts avoid truncated-history assumptions.

Initial checks exposed compact-unit normalization (45kgsx10), outdated failure/response expectations, and bounded context lookup edges. Fixed the actual parser/context/safety behavior and strengthened durable no-mutation assertions; no requirements or local Zod validation were weakened. A production build first inherited the development server's NODE_ENV; rerunning with the correct production build environment passed. No required test remains failing.

Implementation/file map and remaining conversational limitations: [conversation-orchestration.md](conversation-orchestration.md). Existing privacy, deployment and live-provider release decisions remain unresolved; completing this layer does not approve public release.

## WhatsApp Ownership Verification (2026-10-08)

Node 22.23.3; PostgreSQL 14.24. Existing Phase B worktree changes were preserved. This pass completes only number ownership/linking; no live Meta/Gemini calls or Phase C decisions.

| Validation | Final result |
|---|---|
| npm run lint | PASS |
| npm run typecheck | PASS |
| npm run test | 181 passed, 103 intentionally skipped (102 PostgreSQL cases separately executed plus opt-in diagnostic) |
| npm run test:integration | 54/54 passed |
| npm run test:e2e | 2/2 passed |
| npm run eval | 79 passed, 1 opt-in diagnostic skipped; 82/82 executable fixtures passed |
| npm run test:postgres | 102/102 passed across 11 files |
| Ownership PostgreSQL cases | 12/12 passed (part of full PostgreSQL run) |
| Controlled HTTP Meta provider | PASS, actual signup/profile/routine/challenge APIs -> signed LINK -> encrypted recipient -> exactly-once welcome/plan -> start/log/finish/retry |
| npm run test:whatsapp:web | 2/2 desktop/mobile cases passed, 1280px and 390px |
| npm run test:phase-a:web | 5/5 existing onboarding/selection/ownership cases passed |
| npm run test:release:web | 2/2 signed workout/history/analytics/disconnect cases passed |
| npm run build | PASS |
| Fresh PostgreSQL database | All nine migrations applied in order to ownership_fresh_20261008 |
| Populated Phase B upgrade | PASS; verified links/ciphertext preserved, unbound outstanding tokens superseded, rerun safe |
| Local development database upgrade | Applied through 0009 before restoring dev server |
| Secret/privacy scan | 315 repository files scanned; zero configured-secret/private-key matches; no staged files; .env ignored and untracked |
| git diff --check | PASS |

Tests initially exposed a missing outbound createdAt column, test-schema/ledger expectations needing the new constraints/migration, and outdated browser form locators. Fixed underlying schema/fixtures, reran successfully; no assertions weakened. Composite challenge/link/inbound/outbound owner keys now additionally prevent the old fixture's cross-user direct SQL link reassignment. A new retry test proves plan-ready stays pending until welcome has provider acceptance. No failing required tests remain.

### Behaviors And Boundaries

- Explicit international claimed-number parsing uses libphonenumber-js with no default country, expected SHA-256 digits and masked display. Possible-number validation is not proof of assignment/ownership.
- Existing AccountLinkToken holds hashed 128-bit case-insensitive code, ten-minute expiry, supersession, opt-in/change evidence and bounded audit attempts. Existing process-local limiter bounds LINK at 20/minute per provider-scoped sender; durable creation limit is ten/ten minutes per owner. Edge/distributed limits remain an existing operations decision.
- PENDING exists only as a challenge; VERIFIED/REVOKED links gate commands, recipients and notifications. Atomic proof uses authenticated sender data, not the form. Wrong sender preserves the legitimate challenge; other-owner identity cannot transfer; deleted users cannot verify. Revoke and number replacement serialize with commands/delivery and preserve appropriate audit metadata.
- LINK and unverified workout commands make zero Gemini calls. Code/address plaintext is absent from challenge/inbound persistence; final address is AES-256-GCM ciphertext bound to provider identity. No secrets or plaintext recipients are added to exports or routine logs.
- Welcome is the single logical LINK response keyed by link ID. Plan-ready is a unique link/routine/version intent; it waits for provider-accepted welcome. Request/manual delivery, bounded safe retries and existing service-window restrictions remain authoritative; no templates/queues introduced.
- Failed verification has a safe webhook result and leaves the website pending; it does not create a recipient or send normal outbound messages to an unverified identity. Challenge plaintext is returned once: reload preserves masked pending state/expiry, not the code; new issuance is explicit.
- Public WHATSAPP_BUSINESS_NUMBER must be configured with the real business destination before live self-service use. Never derive it from Phone Number ID. Live provider acceptance remains opt-in/unrun. No privacy/legal/public-release approval is implied.
- User confirmed no business WhatsApp destination is currently available. Leave WHATSAPP_BUSINESS_NUMBER unset; live ownership verification/deep-link activation is blocked, not simulated or provisioned by this implementation. Local .env and credentials were not modified.

### Files Touched In This Pass

Configuration/dependency files: `.env.example`, `package.json`, `package-lock.json`, `packages/contracts/src/env.ts`.

Web runtime/UI: `apps/web/server/app.ts`, `apps/web/server/configuration.ts`, `apps/web/app/api/webhooks/whatsapp/route.ts`, `apps/web/app/api/whatsapp/link-token/route.ts`, `apps/web/app/api/whatsapp/link/[id]/route.ts`, `apps/web/components/whatsapp/link-token-manager.tsx`.

Messaging/persistence: `packages/messaging/src/whatsapp/link-challenge.ts`, `packages/messaging/src/whatsapp/link-challenge.test.ts`, `packages/messaging/src/whatsapp/recipient-resolver.ts`, `packages/messaging/src/postgres-delivery.ts`, `packages/persistence/src/whatsapp-links.ts`, `packages/persistence/src/postgres.ts`, `packages/persistence/src/configuration.ts`, `packages/persistence/src/data-controls.ts`, `packages/persistence/migrations/0009_whatsapp_ownership.sql`.

PostgreSQL tests: `tests/postgres/whatsapp-ownership.test.ts`, `tests/postgres/whatsapp-transport.test.ts`, `tests/postgres/postgres-vertical-slice.test.ts`, `tests/postgres/release-hardening.test.ts`, `tests/postgres/phase-a-selection.test.ts`, `tests/postgres/us4.test.ts`, `tests/postgres/us5.test.ts`, `tests/postgres/us6.test.ts`, `tests/postgres/us7.test.ts`.

Integration tests: `tests/integration/ai/inbound-ai-fallback.test.ts`, `tests/integration/messaging/whatsapp-verification.test.ts`.

Browser tests/configs: `tests/e2e/whatsapp/ownership.spec.ts`, `tests/e2e/whatsapp/playwright.config.ts`, `tests/e2e/us1-onboarding-routine.spec.ts`, `tests/e2e/phase-a/playwright.config.ts`, `tests/e2e/core-validation-scenario.spec.ts`, `tests/e2e/release/playwright.config.ts`, `tests/e2e/us4/history-editor.spec.ts`, `tests/e2e/us5/workout-lifecycle.spec.ts`, `tests/e2e/us5/playwright.config.ts`, `tests/e2e/us6-history-analytics.spec.ts`, `tests/e2e/us7-data-controls.spec.ts`.

Feature documentation: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/api.md`, `contracts/messaging.md`, `quickstart.md`, `tasks.md`, `traceability-review.md`, `phase-b-transport.md`, `whatsapp-ownership-verification.md`, `validation-results.md`, `release-readiness.md` under `specs/001-whatsapp-workout-companion/`.

Task reconciliation: T047 newly completed; T038/T039/T046A/T057 amended to actual ownership flow and file paths. No task IDs added/removed; T124 and other open release obligations stay open. Existing reviewer checklist markers remain unchanged.

## Phase B Final Results (2026-10-08)

Phase B transport only. This supersedes earlier transport-absent notes, not the unresolved Phase C release gates. Node **22.23.3**, PostgreSQL **14.24**; Node 22 was first on PATH for every validation script. No live WhatsApp/Gemini calls, new workout behavior, queues or privacy policy were introduced.

| Command / evidence | Final result |
|---|---|
| npm run lint | PASS (existing TypeScript-based lint; T007 still open) |
| npm run typecheck | PASS |
| npm run test | 164 passed, 91 skipped (90 PostgreSQL executed separately + one opt-in diagnostic) |
| npm run test:integration | 46/46 passed |
| npm run test:e2e | 2/2 passed (existing Vitest vertical slices, not new browser acceptance) |
| npm run eval | 71 passed, one diagnostic skipped; 82/82 executable fixtures |
| npm run test:postgres | 90/90 passed, ten files, bounded two-worker scheduling |
| npm run test:whatsapp:transport | 14/14 passed against fresh acceptance database |
| npm run build | PASS |
| git diff --check | PASS |
| Empty database migration | db:migrate applied 0001-0008 successfully to phase_b_transport_acceptance_20261008 |
| Populated upgrade | 0007 -> 0008 tested with historic false SENT and PENDING; reruns preserve quarantine/data |
| Secret-pattern scan | 307 tracked/untracked nonignored files, no suspects; zero staged files; .env confirmed ignored |
| Existing local preview | /onboarding HTTP 200 at http://127.0.0.1:3110 |

Controlled HTTP acceptance uses the actual GET/POST route handlers served over loopback, signed provider-shaped requests, real PostgreSQL, real recipient encryption/resolution and the Cloud API adapter talking to a controllable HTTP provider. It consumes a real link token (no seeded identity), proposes/starts, logs sets, finishes and retrieves completed history. Correct recipient/body/logical ID, one mutation/response/send on duplicate delivery, safe 429 retry, no resend after acceptance and zero deterministic AI calls are asserted. Other PostgreSQL cases cover correction/confirmation replay, retry cap, command-before-outbound restart, in-flight ownership locking, unknown timeout/restart, receipt-before-timeout race, permanent failure, missing recipient, cross-owner/deleted/generation blocking, ciphertext/export isolation and legacy no-replay. Thirteen unit tests cover protection, challenge, response/failure/window handling, real abort normalization and redaction; four HTTP/config integration tests cover validation and no-mutation authenticity rejection.

Initial verification failures were corrected without weakening behavior assertions: the new HTTP acceptance test assumed a numeric response rather than the existing persisted `Logged set`; its set semantics initially assumed unspecified rather than the approved global bench TOTAL_LOAD default. It now asserts the exact stored reply and actual approved load/reps/unit semantics. The existing scripted SQL test double was updated to return the newly required outbound `RETURNING id`, with original AI safety assertions retained. One pre-existing populated-migration test timed out under ten-worker CPU contention; test:postgres now bounds workers at two, with unchanged assertions and 5-second timeout. Final full and dedicated runs pass. Generated next-env build-path churn was restored to the original development paths.

Task count stays 134: checked 114 -> 119. Completed T014/T050/T056/T059/T125; no IDs added, removed or moved. T046C/T048 remain partial; T124 is NOT marked complete based on controlled transport. Other pre-existing unchecked tasks remain untouched. Read-only requirements/readiness checklist gates remain 16/16 and 44/44. No extension hooks are registered.

Live acceptance NOT RUN. The opt-in test:whatsapp:live command verifies challenge and one manually initiated inbound/outbound test exchange, never auto-sends additional messages. Meta credentials/provisioning, actual handset observation, configured Graph-version/callback confirmation, provider processing approval, recipient-key custody/rotation, hosting/edge controls and Phase C physical/backup erasure, retention and propagation decisions remain open. Ambiguous delivery cannot promise eventual delivery; operator report/manual safe retry is intentional. Large replies exceeding 4096 characters fail durably rather than being silently truncated; large-batch request deadlines and performance budgets still require production review. No public-release approval or legal-compliance claim.

Local self-service MVP complete: **YES**. Controlled end-to-end transport: **YES**. Live end-to-end WhatsApp MVP acceptance complete: **NO**. Public release ready: **NO**. Implementation stops after Phase B.

### Phase B Files Changed

- .env.example
- package.json
- apps/web/app/api/webhooks/whatsapp/route.ts
- apps/web/server/whatsapp/transport.ts
- packages/contracts/src/env.ts
- packages/domain/src/observability/events.ts
- packages/messaging/src/index.ts
- packages/messaging/src/transport.ts
- packages/messaging/src/postgres-delivery.ts
- packages/messaging/src/whatsapp/inbound-adapter.ts
- packages/messaging/src/whatsapp/outbound-adapter.ts
- packages/messaging/src/whatsapp/recipient-resolver.ts
- packages/messaging/src/whatsapp/verification.ts
- packages/messaging/src/whatsapp/transport.test.ts
- packages/persistence/src/postgres.ts
- packages/persistence/migrations/0008_whatsapp_transport.sql
- scripts/whatsapp-delivery.ts
- scripts/whatsapp-live-smoke.ts
- tests/integration/ai/inbound-ai-fallback.test.ts
- tests/integration/messaging/whatsapp-verification.test.ts
- tests/postgres/postgres-vertical-slice.test.ts
- tests/postgres/release-hardening.test.ts
- tests/postgres/whatsapp-transport.test.ts
- specs/001-whatsapp-workout-companion/contracts/api.md
- specs/001-whatsapp-workout-companion/contracts/messaging.md
- specs/001-whatsapp-workout-companion/data-model.md
- specs/001-whatsapp-workout-companion/plan.md
- specs/001-whatsapp-workout-companion/research.md
- specs/001-whatsapp-workout-companion/quickstart.md
- specs/001-whatsapp-workout-companion/tasks.md
- specs/001-whatsapp-workout-companion/traceability-review.md
- specs/001-whatsapp-workout-companion/release-readiness.md
- specs/001-whatsapp-workout-companion/phase-b-transport.md
- specs/001-whatsapp-workout-companion/validation-results.md

## Phase A Final Results (2026-10-07)

This section supersedes setup/start gaps and counts in the historical hardening run below. Scope is approved core self-service only; no Phase B/C work, spec changes or new task IDs.

Runtime: Node 22.23.3, PostgreSQL 14.24. Child scripts use Node 22 first on PATH.

| Command / acceptance | Result |
|---|---|
| npm run lint | PASS; remains TypeScript-only, T007 still open |
| npm run typecheck | PASS |
| npm run test | 147 passed / 77 skipped (76 PostgreSQL cases run separately, one opt-in diagnostic); no live provider call |
| npm run test:integration | 42/42 |
| npm run test:e2e | 2/2 Vitest fast vertical slices; not browser evidence |
| npm run eval | 71 passed / one diagnostic skipped; 82/82 mock fixtures |
| npm run test:postgres | 76/76 in nine files |
| npm run build | PASS; configuration, onboarding and selection routes compile |
| npm run test:phase-a:web | 5/5; actual UI/API, desktop1280/mobile390, foreign/anonymous resource rejection, token expiry UI |
| npm run test:release:web | 2/2; actual setup APIs, signed inbound identity proof, correction/completion/history/analytics/PR and link revocation |
| git diff --check | PASS |

Fresh database `phase_a_release_20261007`: ordered db:migrate succeeds, ledger confirms all seven migrations. Populated 0006-to-0007 configuration upgrade preserves existing templates/identities/cursors. Existing populated integrity upgrade/rerun tests also pass.
Transaction-affinity regression first failed against pool.query(BEGIN); one checked-out client now passes success, trigger-injected rollback/no-orphans and concurrent success/failure cases. Real configuration transactions separately prove mid-plan rollback and four concurrent isolated creations.
Completed and active snapshots survive template edits/rename/reorder and repository restart. Replacement confirmation survives restart and concurrent/repeated deliveries; one audit, one new active workout, stale/foreign targets rejected, off-sequence completion leaves normal cursor unchanged.
Parser and PostgreSQL tests persist 50x8 failed the 9th as eight reps. No failed ninth value or advanced metadata is invented. Missing preferred unit fails with a safe domain error and no set. Profile name/unit round-trip; aliases reuse exact identity and conflicts clarify.
Deterministic start examples make zero AI calls; model START_WORKOUT only proposes. Invalid permanent-action scope is rejected by unchanged local Zod validation before any confirmation/mutation. Permanent sequence reorder uses existing US4 confirmation plus routine/cursor version checks.
Desktop/mobile screenshots reviewed for readable non-overlapping layout and no horizontal overflow. Browser token-expiry checks fast-forward only the browser clock; database expiry/single-use remain enforced server-side. Live Meta delivery and real Gemini quality are not claimed.

Failed attempts were fixed without disabling tests: semantic combobox targeting; replacement assertion now checks the existing applied-confirmation message plus actual new active ID/status; snapshot fixture now configures required preference and uses the real auth credential; invalid model scope now asserts local rejection (it is not a valid proposal). Eval inventedHistory helper is intended for QUERY_HISTORY/UNKNOWN; the start fixture instead asserts START_WORKOUT and no direct persistence field, while PG tests prove runtime authority.

A concurrent regression run hit the existing five-second migration-test timeout under host contention. No test timeout/assertion was relaxed. The final standalone PostgreSQL run passes 76/76 in 29.51s, including the actual populated ledger upgrade/rerun.

Local preview: http://127.0.0.1:3110/onboarding against the fresh Phase A database. Initial environment-loader launches failed with unsupported NODE_OPTIONS; neither local credentials nor .env were edited. The working preview clears NODE_OPTIONS and uses an offline AI placeholder, so it is for deterministic setup/selection review only. Live Gemini is not enabled in that preview. Normal runtime still uses the existing configurable Gemini adapter with properly injected configuration.

Tasks: 134 unchanged, 114 checked / 20 unchecked. T046C/T048 remain partial; T050/T056/T059 and T124/T125 retain transport limitations. Classification continues on the existing analytics surface; no duplicate form/service is introduced merely to change a checkbox. Requirements-quality checklists remain 16/16 and 44/44, untouched. All 19 prior partial core requirement rows have Phase A evidence, with exact references in traceability-review.md; this is not live/public-release satisfaction.
Local Phase A self-service MVP: YES. End-to-end WhatsApp MVP/public production release: NO. Remaining transport, privacy/erasure/backups/retention/propagation, provider processing, hosting/edge, historical outbound reconciliation, toolchain advisories and performance/SLO decisions remain open. No Phase B or C was begun.

## Historical Hardening Run

Phase A source/documentation manifest (65 files; transient Next-generated declarations excluded):

- `.prettierignore`
- `README.md`
- `apps/web/app/(product)/onboarding/page.tsx`
- `apps/web/app/(product)/routines/page.tsx`
- `apps/web/app/api/exercises/[exerciseId]/aliases/route.ts`
- `apps/web/app/api/exercises/[exerciseId]/route.ts`
- `apps/web/app/api/exercises/custom/route.ts`
- `apps/web/app/api/exercises/merge-request/route.ts`
- `apps/web/app/api/exercises/route.ts`
- `apps/web/app/api/profile/route.ts`
- `apps/web/app/api/routines/[routineId]/route.ts`
- `apps/web/app/api/routines/route.ts`
- `apps/web/app/api/whatsapp/link-token/route.ts`
- `apps/web/app/api/whatsapp/link/[id]/route.ts`
- `apps/web/app/api/whatsapp/link/route.ts`
- `apps/web/app/api/workouts/[workoutId]/route.ts`
- `apps/web/app/api/workouts/[workoutId]/sets/[setId]/route.ts`
- `apps/web/app/api/workouts/[workoutId]/sets/route.ts`
- `apps/web/app/api/workouts/start/route.ts`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/styles.css`
- `apps/web/components/routines/exercise-identity-controls.tsx`
- `apps/web/components/routines/routine-editor.tsx`
- `apps/web/components/routines/setup-view.tsx`
- `apps/web/components/routines/workout-selection-controls.tsx`
- `apps/web/components/whatsapp/link-token-manager.tsx`
- `apps/web/server/configuration.ts`
- `package.json`
- `packages/contracts/src/api/configuration.ts`
- `packages/domain/src/parser/set-parser.test.ts`
- `packages/domain/src/parser/us4-parser.ts`
- `packages/domain/src/workouts/start-intent.test.ts`
- `packages/domain/src/workouts/start-intent.ts`
- `packages/evals/fixtures/intent/phase-a-selection.yaml`
- `packages/persistence/migrations/0007_core_configuration.sql`
- `packages/persistence/src/configuration.ts`
- `packages/persistence/src/postgres.ts`
- `packages/persistence/src/us4.ts`
- `packages/persistence/src/workout-lifecycle.ts`
- `packages/persistence/src/workout-selection.ts`
- `specs/001-whatsapp-workout-companion/contracts/api.md`
- `specs/001-whatsapp-workout-companion/release-readiness.md`
- `specs/001-whatsapp-workout-companion/research.md`
- `specs/001-whatsapp-workout-companion/tasks.md`
- `specs/001-whatsapp-workout-companion/traceability-review.md`
- `specs/001-whatsapp-workout-companion/validation-results.md`
- `tests/e2e/core-validation-scenario.spec.ts`
- `tests/e2e/phase-a/playwright.config.ts`
- `tests/e2e/us1-onboarding-routine.spec.ts`
- `tests/e2e/us2-workout-selection.spec.ts`
- `tests/e2e/us4/history-editor.spec.ts`
- `tests/e2e/us5/workout-lifecycle.spec.ts`
- `tests/e2e/us6-history-analytics.spec.ts`
- `tests/e2e/us7-data-controls.spec.ts`
- `tests/integration/routines/configuration-contract.test.ts`
- `tests/postgres/phase-a-configuration.test.ts`
- `tests/postgres/phase-a-routines.test.ts`
- `tests/postgres/phase-a-selection.test.ts`
- `tests/postgres/postgres-vertical-slice.test.ts`
- `tests/postgres/release-hardening.test.ts`
- `tests/postgres/us4.test.ts`
- `tests/postgres/us5.test.ts`
- `tests/postgres/us6.test.ts`
- `tests/postgres/us7.test.ts`

The historical file list/counts below describe the prior hardening pass, not this Phase A manifest.

Date: 2026-10-07. Scope: approved T124-T129, no new product features.
Runtime: Node v22.23.3, npm 10.x. PostgreSQL 14.24 (Ubuntu 14.24-0ubuntu0.22.04.1).

## Final Supported Regression

All npm commands used the Node 22 bin directory first on PATH so child scripts also used Node 22.

| Command | Final result |
|---|---|
| npm run lint | PASS; currently TypeScript-only, not ESLint (T007 remains incomplete). |
| npm run typecheck | PASS |
| npm run test | 138 passed, 53 skipped; 52 PostgreSQL tests run separately and one opt-in schema diagnostic. |
| npm run test:integration | 39/39 passed |
| npm run test:e2e | 2/2 passed; script is Vitest vertical slices, not browser acceptance. |
| npm run eval | 71 passed, one opt-in diagnostic skipped; 79/79 executable fixtures, zero failures. |
| npm run test:postgres | 52/52 passed in six files on a fresh disposable database. |
| npm run build | PASS, all implemented review/API routes compiled. |
| git diff --check | PASS |

Test commands were executed, not inferred from previous runs. No test was disabled or assertion weakened.

## Browser Acceptance

Final sequential rerun against disposable PostgreSQL database release_verification_20261007:

| Command | Result |
|---|---|
| npm run test:us4:web | 3/3 (20.7s) |
| npm run test:us5:e2e | 2/2 (16.6s) |
| npm run test:us6:web | 3/3 (29.6s) |
| npm run test:us7:web | 3/3 (25.2s) |
| npm run test:release:web | 2/2 (25.1s) |

13/13 passed. Desktop 1280px/mobile 390px screenshots inspected, no horizontal overflow.
Analytics tabs have arrow/Home/End navigation, roving focus and visible focus outlines.
Native deletion dialog tests prove initial focus inside the modal, Escape dismissal, reopening and confirmation gating.
These are targeted accessibility checks, not a complete accessibility audit.
No live Meta services or provider secrets used in browser tests.
The release scenario explicitly uses repository routine setup because approved onboarding/routine APIs/UI are absent; it is not proof of full self-service MVP setup or outbound WhatsApp delivery.

## PostgreSQL And Migration Evidence

Created a new empty PostgreSQL database release_verification_20261007 and successfully executed npm run db:migrate.
Ledger verified ordered entries 0001_vertical_slice.sql, 0002_us4.sql, 0003_us5.sql, 0004_us6.sql, 0005_us7.sql, 0006_release_integrity.sql.
The final PostgreSQL suite recreates empty tables/test schemas and applies the current migration content from scratch.
Populated five-migration upgrade and repeated migration runs preserve current set rows unchanged.
Database rejects foreign workout/set/routine ownership, invalid cursor positions and zero-rep sets.
Confirmed merge still succeeds with identity consistency enforced at transaction commit.
Unique active workout, link identity, inbound message, command, set order/key and pending confirmation/deletion invariants remain tested.
Restart tests preserve corrections/audits, histories/PR/analytics values, deletion status and blocked user sessions.
Replay tests preserve pending/sent records, recover crash-before-outbound without reapplying sets, reject foreign sender replay and serialize concurrent commands.
A SENT row is simulated only to verify replay preservation; actual provider-send success is NOT claimed.

## AI / Provider Evidence

Existing opt-in real-provider smoke ran once successfully over the network, using synthetic 45x10 data:

```bash
RUN_REAL_PROVIDER_EVAL=1 node --env-file=.env node_modules/vitest/vitest.mjs run packages/evals/src/real-provider-smoke.test.ts
```

Result: 1/1 passed (2.517s test execution), locally accepted LOG_SET with load45/reps10 and high confidence.
The initial node --env-file=.env --run eval:real-provider launch did not pass the loaded key to its child and failed NOT_CONFIGURED before any provider call; direct Vitest invocation runs the same existing opt-in smoke without exposing the key.
Provider/model unchanged: Gemini Developer API, configurable AI_MODEL (gemini-3.5-flash-lite default), GEMINI_API_KEY, AI_PROVIDER=gemini.
No broad live eval/production WhatsApp provisioning was performed.
Offline provider tests cover 400/401/403/429/5xx, abort/HTTP timeouts, refusal, unavailable transport, malformed JSON, invalid structured output and safety flag/schema rejection.
Full local Zod validation remains intact. High confidence never grants permission; low confidence now deterministically clarifies even with a false clarification flag.
Adversarial delete/pretend-confirm/don't-confirm/foreign-user tests still stop at trusted policy.
Deterministic parser/history/coaching paths assert zero provider calls. Provider failure rolls back, and retry cannot duplicate durable sets.
Mock fixtures measure contract behavior, not live model interpretation quality or resistance to every adversarial input.

## Security And Configuration

.env ignored: git check-ignore .env passed. .env.example contains placeholders, not real credentials.
Final read-only secret scan: 261 tracked/untracked nonignored files, zero matches for the configured key or obvious Gemini key patterns. No staged files (staged scan empty); a sandbox-blocked Git subprocess scan was rerun successfully with approval.
Runtime config with synthetic required values passed; missing production configuration fails before starting Next and prints variable names only. No actual credential was included in report/log/source.
Signals allowlist event/code/path/timing fields, not raw input, exported data, provider payloads or errors.
Rate-limit integration proves 429/Retry-After and no handler execution beyond quota; capacity and expiry tests fail closed.
Callback body cap does not depend on Content-Length. Signature is verified before parsing; signed malformed payloads reject; normalized identity is provider/account scoped; batch processing preserves arrival order.
Independent provider delivery order and actual outbound retry/service-window policies remain unverified.

## Dependency Audit

npm audit: nine development-only vulnerable package entries (six moderate, one high, two critical).
npm audit --omit=dev: zero production findings.
No force fix, override, breaking upgrade or downgrade was applied. tsx already existed transitively; it is now explicitly declared for the migration command.

| Package | Severity | Dependency path | Production impact / disposition |
|---|---|---|---|
| vitest | critical | root devDependency | No production runtime import; suggested 5.0.3 is major. Review upgrade; never expose UI server. |
| tinypool | critical | vitest -> tinypool1.1.1 | Test worker only; fix requires reviewed major toolchain update. |
| vite | high | vitest -> vite5.4.21 (also mocker/vite-node) | Dev server only; major toolchain fix required. |
| @vitest/mocker | moderate | vitest -> @vitest/mocker2.1.9 | Test-only; suggested Vitest major fix. |
| vite-node | moderate | vitest -> vite-node2.1.9 -> vite | Test-only; suggested Vitest major fix. |
| esbuild | moderate | vitest -> vite -> esbuild0.21.5; drizzle-kit -> core-utils -> esbuild0.18.20 | Dev/build/migration tooling; incompatible transitive overrides not applied. |
| @esbuild-kit/core-utils | moderate | drizzle-kit -> esm-loader -> core-utils | Dev migration tooling only; audit suggests unsafe major Drizzle downgrade. |
| @esbuild-kit/esm-loader | moderate | drizzle-kit -> esm-loader | Dev migration tooling only; review instead of forced downgrade. |
| drizzle-kit | moderate | root devDependency -> esm-loader | Not runtime repository path; suggested 0.18.1 downgrade is breaking, not applied. |

## Failed Attempts And Corrections

- New sender guard initially broke a scripted SQL double missing the returned identity hash; fixture now models the actual DB field.
- Foreign analytics test fixture lacked its required profile; profile setup added, isolation assertion unchanged.
- Browser 'same' case initially lacked prior persisted context; now exercises documented prior-set context across messages and duplicate delivery.
- Keyboard assertion initially ran before hydration-ready; test now waits for enabled control before keyboard input.
- New immediate identity FK blocked the approved merge's two-step transaction; now validates at commit, preserving exact final consistency and existing merge tests.
- Upgrade fixture timed out at unchanged five-second limit during concurrent build/test load; batched fixture DDL removes round trips; isolated final full PostgreSQL run passes without raising the timeout.
- Configuration negative checks intentionally exit1, as expected; dependency audit exits1 for unresolved dev advisories. These are documented findings, not failing application regression tests.

## Task And Release Status

T126-T129 complete. T124/T125 partial, deliberately unchecked because full setup and outbound delivery/provider retry policy cannot be validated in this checkout.
No task IDs added/removed or second tasks file; total134 tasks unchanged, 36 remain unchecked (including the two scoped partial hardening tasks).
All137 FRs mapped; 19 partial, seven discretionary MAY items, 111 with current core implementation/test evidence. Applicable core evidence111/130=85.4%; not a full-live acceptance percentage.
Planning checklists remain requirements16/16 and readiness44/44, unchanged. Extension hooks parsed before/after: hooks empty, none to dispatch.
Performance: history set hydration is bulk rather than per-workout SQL, current-query indexes added. Analytics/history/export still load pilot-sized data; summary looks up a name per identity/unit/semantics group and scans current history. Large-history/memory/latency load testing remains open; no SLO claim or architecture redesign.
Privacy: soft deletion only. Physical erasure, backups, retention duration, deletion propagation and external data processing remain explicit production decisions.
MVP implementation complete: NO. Ready for human release review: YES. Public production release: BLOCKED by traceability-review.md R1-R4 and human sign-off.

## Files Changed (37)

- `.env.example`
- `README.md`
- `apps/web/app/api/webhooks/whatsapp/route.ts`
- `apps/web/app/styles.css`
- `apps/web/components/analytics/analytics-view.tsx`
- `apps/web/server/app.ts`
- `apps/web/server/auth.ts`
- `apps/web/server/http.ts`
- `apps/web/server/observability.ts`
- `apps/web/server/rate-limit.ts`
- `package-lock.json`
- `package.json`
- `packages/contracts/src/ai/actions.ts`
- `packages/contracts/src/env.ts`
- `packages/domain/src/observability/events.ts`
- `packages/domain/src/parser/set-parser.ts`
- `packages/domain/src/rate-limit/rate-limit-service.ts`
- `packages/evals/fixtures/intent/out-of-scope.yaml`
- `packages/messaging/src/whatsapp/inbound-adapter.ts`
- `packages/persistence/migrations/0006_release_integrity.sql`
- `packages/persistence/src/postgres.ts`
- `packages/persistence/src/us4.ts`
- `scripts/check-runtime.mjs`
- `scripts/migrate.ts`
- `specs/001-whatsapp-workout-companion/release-readiness.md`
- `specs/001-whatsapp-workout-companion/research.md`
- `specs/001-whatsapp-workout-companion/tasks.md`
- `specs/001-whatsapp-workout-companion/traceability-review.md`
- `specs/001-whatsapp-workout-companion/validation-results.md`
- `tests/e2e/core-validation-scenario.spec.ts`
- `tests/e2e/release/playwright.config.ts`
- `tests/e2e/us7-data-controls.spec.ts`
- `tests/integration/ai/ai-boundary.test.ts`
- `tests/integration/ai/inbound-ai-fallback.test.ts`
- `tests/integration/messaging/idempotency-retry.test.ts`
- `tests/integration/security/privacy-security.test.ts`
- `tests/postgres/release-hardening.test.ts`
