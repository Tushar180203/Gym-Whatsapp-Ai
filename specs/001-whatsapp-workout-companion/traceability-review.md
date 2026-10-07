# Implementation Traceability Review

Date: 2026-10-07. Scope: T124-T129 only. No requirements or reviewer checklist markers changed.

## Verdict

Ready for human review: YES. MVP implementation complete/releasable: NO.
The premise that every planned story is fully implemented does not match this checkout.
This report identifies gaps without implementing additional product surfaces.

All 137 functional requirement IDs are indexed below. 19 have explicit incomplete behavior;
7 are discretionary MAY behaviors; remaining rows identify current core implementation/test evidence.
CORE EVIDENCE is not proof of full live WhatsApp operation, universal route coverage, performance SLOs or model accuracy.
Index coverage is 137/137 (100%). Excluding seven discretionary MAY requirements, core implementation evidence covers 111/130 (85.4%); 19 remain partial, not fully covered. No requirement is omitted from the matrix.
Requirements-quality checklists remain requirements 16/16 and readiness 44/44, not release sign-off.

## Blocking Findings

- R1 HIGH: approved US1 onboarding/routine/link-status/revocation/exercise editor and APIs remain absent. Repository createRoutine is hard-coded and tests call it directly. Profile displayName is silently ignored. No returning-user sign-in surface; secure existing sessions/logout do work. See unchecked T030-T046C and the per-requirement gaps below.
- R2 HIGH: outbound WhatsApp adapter and GET webhook challenge are absent (T014/T050/T056). Persisting a response is not delivery. This pass fixes false SENT records to PENDING; real provider send/retry/service-window behavior is not verified. Historic SENT records from older code require operator reconciliation; never assume delivery or blindly resend them.
- R3 HIGH: start alternatives/session selection/replacement/permanent routine-session sequence changes remain incomplete. Storage policy tests cannot substitute for user execution. See partial FR rows/T053/T054.
- R4 HIGH: privacy release decisions remain unresolved: physical erasure, backup erasure, retention duration and deletion propagation, plus external AI/WhatsApp data handling. Soft deletion blocks access but retains rows/audits/operational message bodies. No GDPR/CCPA compliance claim is made.
- R5 MEDIUM: T007 remains incomplete; lint currently runs the TypeScript compiler, identical to typecheck. T025 observability remains partial: safe failures/duplicate/AI/path signals exist, but full confirmation and outbound lifecycle instrumentation and meaningful deterministic latency distributions are not complete. T124/T125 remain partial for the reasons above. Earlier unchecked tasks are not mechanically marked complete.
- R6 MEDIUM: development toolchain has nine npm audit entries, including two critical; production audit is clean. Major-version remediation requires a separately reviewed toolchain upgrade. Do not expose test/dev servers or execute untrusted tests with credentials.

## Governance Review

Constitution I/XV/XVII/XVIII: artifacts/spec unchanged; gaps, failed attempts, mock/live evidence and deviations recorded.
II-V/VI/VIII/IX: deterministic parser/metrics remain authoritative; low-confidence proposals now clarify even if the provider forgot the flag; high confidence never grants confirmation/ownership. Local full Zod schemas remain authoritative. Synthetic scope fixtures and adversarial boundary tests added; no authoritative AI numbers.
VII/XIII/XIV/XIX: confirmed private identities and independent histories remain; provider interfaces retained; no new features, agents, services, queues, PR cache or retention promises.
X/XI: test results are in validation-results.md; human merge/release review is still mandatory.
XII/XX: security hardening does not substitute for privacy policy. R4 blocks production constitution compliance.

## Readiness Checklist Evidence

All CHK001-CHK044 remain checked as design-quality criteria; implementation evidence follows, without rewriting their markers.

| Items | Current evidence / limitation |
|---|---|
| CHK001-CHK006 | PostgreSQL unique active workout, history snapshots, US4 mutations/US5 finish tests; selection/replacement gaps R3. |
| CHK007-CHK011 | US4 identity/alias/merge and US6 classification tests; rename/editor gap R1. |
| CHK012-CHK016 | Parser tests and persisted KG/LB/default/per-side values; failed-attempt metadata gap FR-029. |
| CHK017-CHK021 | US4 correction/deletion audit, US5 current-truth PRs, US7 removal tests; expiry/stale/duplicate coverage. |
| CHK022-CHK024 | US5 cursor and off-sequence policy tests; user selection/permanent sequence reorder gap R3. |
| CHK025-CHK028 | Signed normalized token-consumption path and replay identity guard; challenge/outbound gap R2. |
| CHK029-CHK031 | PostgreSQL recovery/replay/concurrency/restart tests; real send/retry policy not proven R2. |
| CHK032-CHK035 | Local schemas, guard tests, deterministic zero-provider-call tests, Gemini normalization tests; live smoke is narrow. |
| CHK036-CHK039 | Exact comparable history/derived PR/primary-only analytics and coaching-boundary tests. |
| CHK040 | Secure sessions, owner queries, data control tests, redacted log allowlist, bounded local limits; external edge policy/privacy R4. |
| CHK041-CHK044 | Contract routes inventoried below; absent routes R1/R2, mock eval limitations documented; simple single-app architecture preserved. |

## Route Review

Every implemented API route uses apiResponse; owner session resolution is required except signup and signed provider callback. Logout is harmless on repeat.
Foreign workout/set/classification/export/deletion request IDs are not authorization; PostgreSQL regressions and browser HTTP tests cover them.
Profile takes owner from session, not client userId. Analytics/history use owner snapshots. Alias/correction targets resolve only inside owner-scoped commands.
Absent routine/alias/rename routes cannot be claimed tested or completed. Request-ID enumeration returns safe not-found errors.
CSRF uses canonical origin when present plus HttpOnly SameSite=Strict cookies; no spoofed forwarding headers are trusted by rate limits.
Account-deletion receipt replay is limited to exact owner/original unexpired session credential and completed request, never renewed auth.

## Functional Requirement Matrix

Paths are relative to repository root. Test files are direct evidence locations, not claims that every line of every requirement has a dedicated named test.

| Requirement | Tasks | Implementation | Test / eval evidence | Status |
|---|---|---|---|---|
| FR-001 | T034-T046C | apps/web/app/api/auth/signup/route.ts; apps/web/app/api/profile/route.ts; packages/persistence/src/postgres.ts | tests/postgres/postgres-vertical-slice.test.ts; tests/e2e/core-validation-scenario.spec.ts | CORE EVIDENCE |
| FR-002 | T034-T046C | apps/web/app/api/auth/signup/route.ts; apps/web/app/api/profile/route.ts; packages/persistence/src/postgres.ts | tests/postgres/postgres-vertical-slice.test.ts; tests/e2e/core-validation-scenario.spec.ts | PARTIAL: Profile PATCH accepts but ignores displayName. |
| FR-003 | T034-T046C | apps/web/app/api/auth/signup/route.ts; apps/web/app/api/profile/route.ts; packages/persistence/src/postgres.ts | tests/postgres/postgres-vertical-slice.test.ts; tests/e2e/core-validation-scenario.spec.ts | CORE EVIDENCE |
| FR-004 | T034-T046C | apps/web/app/api/auth/signup/route.ts; apps/web/app/api/profile/route.ts; packages/persistence/src/postgres.ts | tests/postgres/postgres-vertical-slice.test.ts; tests/e2e/core-validation-scenario.spec.ts | CORE EVIDENCE |
| FR-005 | T034-T046C | apps/web/app/api/auth/signup/route.ts; apps/web/app/api/profile/route.ts; packages/persistence/src/postgres.ts | tests/postgres/postgres-vertical-slice.test.ts; tests/e2e/core-validation-scenario.spec.ts | CORE EVIDENCE |
| FR-006 | T034-T046C | apps/web/app/api/auth/signup/route.ts; apps/web/app/api/profile/route.ts; packages/persistence/src/postgres.ts | tests/postgres/postgres-vertical-slice.test.ts; tests/e2e/core-validation-scenario.spec.ts | PARTIAL: Routine configuration is hard-coded in repository setup; approved web/API routine creation is absent. |
| FR-007 | T034-T046C | apps/web/app/api/auth/signup/route.ts; apps/web/app/api/profile/route.ts; packages/persistence/src/postgres.ts | tests/postgres/postgres-vertical-slice.test.ts; tests/e2e/core-validation-scenario.spec.ts | PARTIAL: No user-facing session naming/configuration API. |
| FR-008 | T034-T046C | apps/web/app/api/auth/signup/route.ts; apps/web/app/api/profile/route.ts; packages/persistence/src/postgres.ts | tests/postgres/postgres-vertical-slice.test.ts; tests/e2e/core-validation-scenario.spec.ts | PARTIAL: No user-facing planned-exercise configuration API. |
| FR-009 | T034-T046C | apps/web/app/api/auth/signup/route.ts; apps/web/app/api/profile/route.ts; packages/persistence/src/postgres.ts | tests/postgres/postgres-vertical-slice.test.ts; tests/e2e/core-validation-scenario.spec.ts | PARTIAL: Planned counts exist but no user setup form/API. |
| FR-010 | T034-T046C | apps/web/app/api/auth/signup/route.ts; apps/web/app/api/profile/route.ts; packages/persistence/src/postgres.ts | tests/postgres/postgres-vertical-slice.test.ts; tests/e2e/core-validation-scenario.spec.ts | PARTIAL: Rep targets exist but no user setup form/API. |
| FR-011 | T034-T046C | apps/web/app/api/auth/signup/route.ts; apps/web/app/api/profile/route.ts; packages/persistence/src/postgres.ts | tests/postgres/postgres-vertical-slice.test.ts; tests/e2e/core-validation-scenario.spec.ts | PARTIAL: Session mutations exist; planned routine editor is absent. |
| FR-012 | T034-T046C | apps/web/app/api/auth/signup/route.ts; apps/web/app/api/profile/route.ts; packages/persistence/src/postgres.ts | tests/postgres/postgres-vertical-slice.test.ts; tests/e2e/core-validation-scenario.spec.ts | PARTIAL: No configurable routine frequency/schedule persistence/surface. |
| FR-013 | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | CORE EVIDENCE |
| FR-014 | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | CORE EVIDENCE |
| FR-015 | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | CORE EVIDENCE |
| FR-016 | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | CORE EVIDENCE |
| FR-017 | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | CORE EVIDENCE |
| FR-018 | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | CORE EVIDENCE |
| FR-018a | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | CORE EVIDENCE |
| FR-018b | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | CORE EVIDENCE |
| FR-018c | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | CORE EVIDENCE |
| FR-018d | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | CORE EVIDENCE |
| FR-018e | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | OPTIONAL |
| FR-018f | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | CORE EVIDENCE |
| FR-018g | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | PARTIAL: Stable IDs exist; exercise rename endpoint/workflow is absent. |
| FR-018h | T090-T101; T031/T040-T045 incomplete | packages/persistence/src/us4.ts; packages/domain/src/exercises/unknown-exercise-flow.ts | tests/postgres/us4.test.ts; tests/postgres/us6.test.ts | CORE EVIDENCE |
| FR-019 | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | PARTIAL: Deterministic start accepts only literal start; alternative start intents are not dispatched. |
| FR-020 | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | PARTIAL: Cursor selection is implemented; separate proposal/acceptance path is absent. |
| FR-021 | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | PARTIAL: No complete routine/session start ambiguity selection path. |
| FR-022 | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | PARTIAL: Start presents active context, not the full planned session list. |
| FR-023 | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | PARTIAL: Pre-start selection/rest/temporary-change surface is incomplete. |
| FR-024 | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-024a | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-024b | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | PARTIAL: Off-sequence policy is tested at storage level; user session-selection command is absent. |
| FR-024c | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-024d | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | PARTIAL: Existing workout is preserved and choices shown; replacement choice is not implemented. |
| FR-024e | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | PARTIAL: Replacement workflow is absent, rather than authorized without consent. |
| FR-024f | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-025 | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-026 | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-027 | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-027a | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-027b | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-027c | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-027d | T051-T060; T105-T107 | packages/persistence/src/postgres.ts; packages/persistence/src/workout-lifecycle.ts | tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-028 | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-029 | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | PARTIAL: Recorded numeric notation works; failed-attempt metadata is not persisted. |
| FR-030 | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-030a | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-030b | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-030c | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-030d | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-030e | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | OPTIONAL |
| FR-030f | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-030g | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-031 | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-032 | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-033 | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-034 | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-035 | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-035a | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-035b | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-035c | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-035d | T061-T071; T097 | packages/domain/src/parser/set-parser.ts; packages/persistence/src/postgres.ts; packages/persistence/src/us4.ts | packages/domain/src/parser/set-parser.test.ts; tests/postgres/us4.test.ts; tests/postgres/postgres-vertical-slice.test.ts | CORE EVIDENCE |
| FR-036 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-037 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-038 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-039 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-039a | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | OPTIONAL |
| FR-039b | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-039c | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-039d | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-039e | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-039f | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-039g | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-040 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-041 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-042 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-043 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-044 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-045 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-046 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-047 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-048 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-049 | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-049a | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-049b | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-049c | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-049d | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-049e | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | CORE EVIDENCE |
| FR-049f | T090-T101 | packages/persistence/src/us4.ts; packages/domain/src/corrections/correction-command.ts | tests/postgres/us4.test.ts; tests/e2e/us4/history-editor.spec.ts | PARTIAL: Confirmed exercise reorder exists; permanent session sequence reorder is absent. |
| FR-050 | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-051 | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-052 | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-052a | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-052b | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | OPTIONAL |
| FR-052c | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-052d | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-052e | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-052f | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-052g | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-052h | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-053 | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-054 | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-055 | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-056 | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-057 | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-057a | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-057b | T102-T107; T115 | packages/persistence/src/workout-lifecycle.ts; packages/persistence/src/workout-history-queries.ts; packages/analytics/src/personal-record-service.ts | tests/postgres/us5.test.ts; tests/e2e/us5/workout-lifecycle.spec.ts | CORE EVIDENCE |
| FR-058 | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-059 | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-060 | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-060a | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-060b | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-060c | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-060d | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-061 | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-062 | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-063 | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | OPTIONAL |
| FR-064 | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-065 | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-066 | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-066a | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-066b | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-066c | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-066d | T108-T116 | packages/analytics/src/workout-analytics-service.ts; packages/analytics/src/history-question-service.ts; packages/persistence/src/analytics-queries.ts | tests/postgres/us6.test.ts; tests/e2e/us6-history-analytics.spec.ts | CORE EVIDENCE |
| FR-067 | T071; T107 | packages/domain/src/workouts/workout-response.ts; packages/persistence/src/workout-lifecycle.ts | packages/domain/src/workouts/workout-response.test.ts; tests/postgres/us5.test.ts | OPTIONAL |
| FR-068 | T071; T107 | packages/domain/src/workouts/workout-response.ts; packages/persistence/src/workout-lifecycle.ts | packages/domain/src/workouts/workout-response.test.ts; tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-069 | T071; T107 | packages/domain/src/workouts/workout-response.ts; packages/persistence/src/workout-lifecycle.ts | packages/domain/src/workouts/workout-response.test.ts; tests/postgres/us5.test.ts | CORE EVIDENCE |
| FR-070 | T078-T089; T126-T127 | packages/ai/src/structured-intent-interpreter.ts; packages/contracts/src/ai/actions.ts; packages/persistence/src/us4.ts | tests/integration/ai/ai-boundary.test.ts; packages/ai/src/providers/gemini-structured-output-client.contract.test.ts; packages/evals/src/runner.test.ts | OPTIONAL |
| FR-071 | T078-T089; T126-T127 | packages/ai/src/structured-intent-interpreter.ts; packages/contracts/src/ai/actions.ts; packages/persistence/src/us4.ts | tests/integration/ai/ai-boundary.test.ts; packages/ai/src/providers/gemini-structured-output-client.contract.test.ts; packages/evals/src/runner.test.ts | CORE EVIDENCE |
| FR-072 | T078-T089; T126-T127 | packages/ai/src/structured-intent-interpreter.ts; packages/contracts/src/ai/actions.ts; packages/persistence/src/us4.ts | tests/integration/ai/ai-boundary.test.ts; packages/ai/src/providers/gemini-structured-output-client.contract.test.ts; packages/evals/src/runner.test.ts | CORE EVIDENCE |
| FR-073 | T117-T123 | packages/persistence/src/data-controls.ts; packages/domain/src/data-controls/export-service.ts; apps/web/components/data-controls/data-controls-view.tsx | tests/postgres/us7.test.ts; tests/e2e/us7-data-controls.spec.ts | CORE EVIDENCE |
| FR-074 | T117-T123 | packages/persistence/src/data-controls.ts; packages/domain/src/data-controls/export-service.ts; apps/web/components/data-controls/data-controls-view.tsx | tests/postgres/us7.test.ts; tests/e2e/us7-data-controls.spec.ts | CORE EVIDENCE |
| FR-075 | T117-T123 | packages/persistence/src/data-controls.ts; packages/domain/src/data-controls/export-service.ts; apps/web/components/data-controls/data-controls-view.tsx | tests/postgres/us7.test.ts; tests/e2e/us7-data-controls.spec.ts | CORE EVIDENCE |
| FR-076 | T117-T123 | packages/persistence/src/data-controls.ts; packages/domain/src/data-controls/export-service.ts; apps/web/components/data-controls/data-controls-view.tsx | tests/postgres/us7.test.ts; tests/e2e/us7-data-controls.spec.ts | CORE EVIDENCE |
| FR-077 | T127 | packages/ai/src/prompt-registry.ts; packages/analytics/src/history-question-service.ts | packages/evals/fixtures/intent/out-of-scope.yaml; tests/postgres/us6.test.ts | CORE EVIDENCE |
