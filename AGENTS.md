# AGENTS.md — Gym-Whatsapp-Ai

Canonical instructions for every AI coding agent in this repository (Codex, Claude Code, others).
Tool-specific files (`CLAUDE.md`, `apps/web/AGENTS.md`) import or extend this file; never duplicate it.
Policy: [docs/ai-policy.md](docs/ai-policy.md) · Onboarding: [docs/ai-onboarding.md](docs/ai-onboarding.md) · Owner: see [CODEOWNERS](.github/CODEOWNERS).

## What this is

WhatsApp-first workout companion with a Next.js web product. TypeScript monorepo (npm workspaces `apps/*`, `packages/*`;
all scripts and dependencies live in the root `package.json`). Overview: [docs/architecture.md](docs/architecture.md). Governing rules:
[.specify/memory/constitution.md](.specify/memory/constitution.md) — it overrides plans, tasks and agent claims.

## Stack (versions matter — do not rely on training data)

- Node 22 LTS (`.nvmrc`, `engines`), npm ≥ 10, TypeScript 5.x strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Next.js 16 + React 19 — read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/` before web changes
- PostgreSQL via `pg` + Drizzle 0.45, Zod 4, Vitest 2, Playwright 1.6x
- AI provider: Gemini behind `packages/ai` adapters (product feature; never call it from tests by default)

## Commands (exact; run from repo root)

| Purpose | Command |
|---|---|
| Install | `npm ci` |
| Lint (tsc) | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Unit + integration tests | `npm test -- --reporter=dot` |
| One test file / one test | `npx vitest run path/to/file.test.ts -t "test name" --reporter=dot` |
| Domain conversation tests | `npm run test:conversation` |
| AI contract evals (mocked, offline) | `npm run eval` |
| PostgreSQL suites | `TEST_DATABASE_URL=postgresql://... npm run test:postgres` (disposable DB only) |
| Web e2e (Playwright) | `npm run test:release:web` (needs `TEST_DATABASE_URL`) |
| Build | `npm run build` |
| AI config validation | `npm run check:ai-config` |
| Full local gate | `npm run verify` |

Verbose output: prefer `--reporter=dot` and pipe long logs through `tail -n 60`; do not paste full logs into context.

## Where to find what

| Path | Contents |
|---|---|
| `apps/web/app/` | Next.js routes, API routes, WhatsApp webhooks (`app/api/webhooks/whatsapp/`, `app/webhooks/meta/`) |
| `apps/web/components/`, `apps/web/server/` | UI components; server-only helpers |
| `packages/domain/` | Provider-independent workout model, conversation orchestrator, corrections |
| `packages/contracts/` | Zod schemas shared by web, WhatsApp, AI and tests |
| `packages/persistence/` | PostgreSQL queries and ordered SQL migrations (`migrations/00NN_*.sql`) |
| `packages/ai/` | Provider abstraction, prompt registry, structured intent interpreter |
| `packages/messaging/`, `packages/analytics/` | WhatsApp adapter; deterministic analytics and PRs |
| `packages/evals/` | AI eval runner and YAML fixtures (`fixtures/intent/`) |
| `tests/integration/`, `tests/postgres/`, `tests/e2e/` | Integration, DB-backed and Playwright suites |
| `specs/001-whatsapp-workout-companion/` | Spec, plan, data model, contracts, quickstart, tasks |
| `docs/` | Architecture, ADRs, AI policy, onboarding, lessons learned |
| `.agents/skills/` | Shared skills (Spec Kit `speckit-*` + project skills); `.claude/skills` links here |

## Conventions

- Spec first: every change traces to `specs/**/spec.md`, `tasks.md`, a bug, or an ADR (constitution I, XVII).
- AI output never mutates durable state directly; validate structured output with `packages/contracts` (III, IV).
- Never invent workout data; ask for clarification instead (V). Analytics and PRs are deterministic (VIII).
- Prompt or intent changes MUST add/update eval cases in `packages/evals/fixtures/intent/` (IX).
- New migrations: next number in `packages/persistence/migrations/`, never edit an applied migration.
- Keep provider-specific code inside `packages/ai` / `packages/messaging` adapters (XIII).
- Tests sit beside code (`*.test.ts`) or under `tests/`; fixtures use `@example.com` and `555` numbers only.

## Done means verified

Before saying a task is complete:
1. `npm run lint` and `npm test -- --reporter=dot` pass (the Stop hook and pre-push hook also enforce this).
2. Changed AI behaviour → `npm run eval` passes. Changed SQL/persistence → run the relevant `tests/postgres` file.
3. Changed web UI → run the relevant `test:*:web` Playwright suite.
4. State exactly which checks ran, which did not, and why (constitution XVIII). Never skip, `.only`,
   or weaken a test to get green; never lower thresholds or add `--passWithNoTests`.

## Safety rules (enforced by hooks/deny rules — see docs/ai-policy.md)

- Never read or print `.env*` (except `.env.example`), keys, tokens or `specs/**/evaluation-runs/` logs.
- Never run destructive commands: `rm -rf`, `git push --force`, `git reset --hard`, `--no-verify`,
  `DROP`/`TRUNCATE`, `curl … | sh`. Never push to `main`; work on a branch and open a PR.
- Human approval is always required for: `npm run db:migrate`, `test:whatsapp:live`, `eval:*:live`,
  `eval:real-provider`, `whatsapp:delivery`, `memory:prune`, dependency additions, CI/agent-config edits,
  creating GitHub issues/PRs. Ask first and wait.
- New npm packages: justify in the PR, prefer existing deps, exact version, human verifies the publisher.
- Commits made with AI help carry a trailer, e.g. `Co-Authored-By: Claude <noreply@anthropic.com>` or
  `Co-Authored-By: Codex <noreply@openai.com>`, and PRs get the `ai-assisted` label.

## Working style

- Plan first for anything touching > 3 files or a migration; use `speckit-plan`/`speckit-tasks` for features.
- One task per session; start a fresh session (or `/clear`) between unrelated tasks; `/compact` long sessions.
- Model choice: fast/small model for search, docs and test scaffolding; the most capable model for
  orchestration, persistence, AI-boundary and security changes. Details in docs/ai-policy.md §6.
- Keep PRs ≤ 400 changed lines where possible; split by vertical slice (constitution XVI).

## Skills (in `.agents/skills/`)

`fix-bug`, `write-tests`, `verify-change`, `review-pr`, `db-migration` (manual only), plus Spec Kit
`speckit-specify → clarify → plan → tasks → analyze → implement → converge`.

## Gotchas

- `npm run lint` and `npm run typecheck` are both `tsc --noEmit`; there is no ESLint.
- `next dev` rewrites the block in `apps/web/AGENTS.md`; commit it as-is.
- PostgreSQL suites reset tables: `TEST_DATABASE_URL` must never point at an application database.
- Live provider tests are opt-in via env flags (`RUN_REAL_PROVIDER_EVAL`, `RUN_LIVE_CONVERSATION_EVAL`).

## Lessons learned

Agent mistakes become rules here and in [docs/ai-lessons.md](docs/ai-lessons.md). Add a dated entry when you fix one.
