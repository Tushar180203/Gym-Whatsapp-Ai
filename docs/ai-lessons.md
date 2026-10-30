# AI lessons learned

Feedback loop: when an agent makes a mistake worth preventing, add a dated entry here and, where possible, turn it
into a rule in `AGENTS.md`, a hook in `.claude/hooks/`, or a check in `scripts/check-ai-config.mjs`. Reviewed monthly.

| Date | What happened | Prevention added |
|---|---|---|
| 2026-10-29 | Agent instructions said "run tests before review" only in prose; work was committed straight to `main` with no checks. | Stop hook (`verify-on-stop.mjs`), pre-commit/pre-push hooks, CI, branch protection (ADR 0001) |
| 2026-10-29 | `next dev` regenerates the block in `apps/web/AGENTS.md`; agents may revert it as noise. | Gotcha in `AGENTS.md`: commit the block as-is |

## 2026-10-29 — Register migrations and isolate browser builds

- A new migration file must also be added to the ordered list in `PostgresVerticalSliceApp.migrate()`. Verify the new columns on a fresh disposable schema before treating profile or persistence code as ready; adding the SQL file alone does not apply it.
- Before starting a Next.js browser-test server, account for an existing development server in the same checkout. Use a separate test build directory rather than stopping the user's server, and restore the normal generated type references after verification.

## 2026-10-30 — Validate HTTP input before application work

- JSON routes used unbounded `request.json()` reads; schema validation alone did not limit the bytes buffered before parsing. Use the shared `readJsonBody` helper for JSON object requests, with a 1 MiB streaming limit and an explicit JSON content type. Keep webhook signature verification on the original bounded body.
- Signup accepted passwords longer than login allowed. Share credential contracts so both enforce the same maximum; reject invalid credentials before hashing. Regression coverage: `tests/integration/security/request-validation.test.ts` (FR-001, FR-072, constitution XII).

## 2026-10-30 — Do not treat filler words as session names

- The deterministic grammar captured everything after "start" as a `sessionRef`, so "lets start today" asked for a session named "today" and replied "No matching planned workout". Cut off follow-up questions ("…, what's the plan", "and show me…") and strip time/filler words ("today", "now", "my workout", "please") before using the remainder as a session name; when nothing remains, start the next planned session. Regression coverage: `packages/domain/src/conversation/conversation.test.ts` ("routes … to the next planned session").
