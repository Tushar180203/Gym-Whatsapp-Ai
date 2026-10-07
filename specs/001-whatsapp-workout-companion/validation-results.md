# Release Validation Results

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
