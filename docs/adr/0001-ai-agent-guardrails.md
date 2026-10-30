# 0001 — Deterministic guardrails for AI coding agents

Status: Accepted · Date: 2026-10-29 · Owner: AI config owner (see docs/ai-policy.md §1)

## Context

The project is built mostly with AI agents (Codex via Spec Kit, Claude Code). The constitution
(`.specify/memory/constitution.md`, principles X, XI, XVIII) requires tests, human review and failure
transparency, but until now these were prose only: no hooks, no permission policy, no CI and direct commits to `main`.

## Decision

1. One canonical instruction file, `AGENTS.md`; `CLAUDE.md` files import it; skills live once in `.agents/skills`.
2. Enforce safety in code: Claude Code hooks + deny rules + sandbox, Codex sandbox/approval config, git hooks
   (`.githooks/`), and CI (`.github/workflows/`) including secret, dependency and SAST scanning.
3. Validate the agent configuration itself with `scripts/check-ai-config.mjs` locally and in CI, and test the
   guard hooks in `tests/ai-config/`.
4. All changes go through PRs with CODEOWNERS review and AI attribution trailers.

## Consequences

- Agents are blocked from destructive commands and secret files and must pass lint/tests before stopping.
- Some workflows (migrations, live provider tests, dependency installs) now always need a human.
- Guard rules must be maintained; changes to them are reviewed monthly (docs/ai-policy.md §11).
