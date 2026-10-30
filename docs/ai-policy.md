# AI Usage Policy — Gym-Whatsapp-Ai

Version 1.0 · Effective 2026-10-29 · Next review 2026-11-30 (monthly, see §11)

Applies to every AI coding agent used on this repository. The product's own Gemini integration is out of scope
except where noted. Enforcement lives in code: `.claude/settings.json`, `.claude/hooks/`, `.codex/config.toml`,
`.githooks/`, `.github/workflows/` and `scripts/check-ai-config.mjs`.

## 1. Ownership

| Role | Who | Responsibility |
|---|---|---|
| AI config owner | @Tushar180203 | Approves changes to agent config, skills, hooks, MCP; runs the monthly review |
| Backup owner | **TO BE ASSIGNED** (second FiftyFive engineer) | Same rights; covers absence; must be added to `.github/CODEOWNERS` |

Owned paths: `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`, `.agents/`, `.claude/`, `.codex/`,
`.specify/`, `.githooks/`, `.github/`, `docs/ai-*.md`, `scripts/check-ai-config.mjs` (enforced by CODEOWNERS).

## 2. Approved tools and accounts

| Tool | Status | Shared config |
|---|---|---|
| OpenAI Codex (CLI/IDE) | Approved | `AGENTS.md`, `.codex/config.toml`, `.agents/skills/` |
| Claude Code | Approved | `CLAUDE.md` → `AGENTS.md`, `.claude/settings.json`, `.claude/skills` → `.agents/skills` |
| GitHub Spec Kit 1.0.13 (+ `assess` extension 1.0.1) | Approved | `.specify/` |
| Any other agent (Cursor, Copilot, Gemini CLI, …) | Needs owner approval + PR adding its config | — |

Only FiftyFive organisation-managed accounts (team/enterprise plans with training on customer data disabled) may
be used on this code. Personal/free accounts are forbidden. Keys come from the org admin console, never shared.

## 3. Data classes

| Class | Examples | Agents may |
|---|---|---|
| Public / code | Source, specs, docs, synthetic fixtures (`@example.com`, `+1555…`) | Read, edit |
| Internal | Architecture notes, eval YAML, migrations | Read, edit via PR |
| Secret | `.env*` (except `.env.example`), keys, tokens, `DATABASE_URL`, Meta/Gemini credentials | Never read, print or send |
| Personal / production data | Real WhatsApp numbers, chats, workout history, DB dumps, `specs/**/evaluation-runs/` logs, `test-results/` | Never read; never commit |

Enforcement: Claude deny rules + `sandbox.filesystem.denyRead` + `guard-paths.mjs`/`guard-bash.mjs`; Codex
`shell_environment_policy.exclude` + sandbox; `.gitignore`; pre-commit secret scan; CI gitleaks. Test data must be
synthetic. Production dumps are never stored in the repo. Never paste production data into any AI chat.

## 4. Dangerous actions — always need a human

Blocked deterministically (hooks/deny rules): `rm -rf`, force-push, push to `main`, `--no-verify`, `git reset --hard`,
`git clean -f`, `DROP`/`TRUNCATE`, `curl … | sh`, `sudo`, `npm publish`, `terraform destroy`, `kubectl delete`,
reading secrets. Require explicit human approval (ask rules/hooks/manual-only skills):

- `npm run db:migrate`, any command against a non-disposable database
- Live provider or messaging commands: `test:whatsapp:live`, `eval:real-provider`, `eval:conversation:*` live modes,
  `whatsapp:delivery`, `memory:prune`
- `npm install`/new dependencies, `git push`, any `gh` command (issues, PRs)
- Edits to `.github/`, agent config, `AGENTS.md`/`CLAUDE.md`, applied migrations, `package*.json`
- Skills with side effects (`db-migration`, `speckit-taskstoissues`) are `disable-model-invocation: true`

Bypass modes are forbidden outside a disposable container: Claude `bypassPermissions` is disabled via
`permissions.disableBypassPermissionsMode`, `--dangerously-skip-permissions` is not allowed, and Codex
`danger-full-access`/`approval_policy = "never"` are rejected by `npm run check:ai-config`.

## 5. Sandbox and network

Claude Code runs with `sandbox.enabled` (bubblewrap on Linux; install `bubblewrap socat`), network limited to
`registry.npmjs.org`, `github.com`, `api.github.com`, `nextjs.org`. Codex runs `workspace-write` with
`network_access = false`. Agent shells must not hold production credentials.

## 6. Models and cost

| Task | Model guidance |
|---|---|
| Search, docs, test scaffolding, simple refactors | Fast tier (e.g. Claude Haiku / Sonnet, Codex mini) |
| Domain, persistence, AI-boundary, security, orchestration changes | Most capable tier (e.g. Claude Opus, GPT-5 Codex high) |
| Broad codebase searches | Subagent, so results do not bloat the main context |

Spend MUST be tracked per project in the org admin consoles (Anthropic Console / OpenAI usage) by the config
owner, with a monthly budget alert at 80 % of the agreed budget. The owner records monthly spend in the review (§11).

## 7. MCP servers and plugins

Inventory (update via PR, owner approval required):

| Name | Type | Source / version | Purpose | Owner | Status |
|---|---|---|---|---|---|
| Spec Kit `assess` extension | Spec Kit extension (prompt-only commands) | `github/spec-kit` 1.0.1, manifest-hash pinned in `.specify/extensions/.registry` | Idea assessment before specs | @Tushar180203 | Enabled; no hooks registered |
| GitHub MCP server | MCP | Not configured in repo | Used only by manual `speckit-taskstoissues` | @Tushar180203 | Personal config only, read-write; prefer `gh` CLI |

Rules: official publishers only, exact versions (no `@latest`), credentials from env/OAuth, read-only scopes by
default, no `enableAllProjectMcpServers`, no `mcp__*` wildcard allows, HTTPS for remote servers, write tools
require approval. `npm run check:ai-config` rejects violations in `.mcp.json`.

New dependencies proposed by agents: justified in the PR, exact version, publisher verified by a human;
Dependabot and `npm audit` (security workflow) check every PR; dependency review returns once the
repository's Dependency graph setting is enabled.

## 8. Review and attribution

- All changes, including AI config, land through PRs to `main` (branch protection, CODEOWNERS review, CI green).
- AI-assisted commits carry a `Co-Authored-By:` trailer naming the tool; AI-assisted PRs get the `ai-assisted`
  label and fill the PR template's AI section. AI reviewers may comment but never replace human approval.
- PRs should stay ≤ 400 changed lines; split larger work into vertical slices (constitution XVI).

## 9. Licence and IP

AI-generated code is owned by the client/FiftyFive under the engagement contract and is reviewed like human code.
Agents must not copy code from sources with incompatible licences (GPL/AGPL, unlicensed snippets) or reproduce
large verbatim third-party text. New dependencies must carry MIT/Apache-2.0/BSD/ISC-compatible licences.

## 10. Privacy, regulation and retention

The product processes personal data (WhatsApp numbers, workout history) → GDPR/DPDP principles apply: data
minimisation, export and deletion (US7, `specs/001-whatsapp-workout-companion/spec.md`), no personal data in prompts
beyond what the product feature needs. AI tool transcripts follow the retention terms of the FiftyFive org agreement
with each vendor (the owner records the current terms in the review log); local transcripts are never committed. Prompt logging via telemetry
(`OTEL_LOG_USER_PROMPTS`) stays off unless the owner approves it in writing.

## 11. Observability, feedback and review cadence

- Telemetry: Claude Code OpenTelemetry (`CLAUDE_CODE_ENABLE_TELEMETRY=1` with the org collector endpoint) and the
  OpenAI usage dashboard; owner: AI config owner. Prompts are not logged (§10).
- Failures: label issues/PRs `ai-bug` (defect introduced by AI-assisted code) and `ai-assisted`; reverts of AI
  changes reference the original PR. Each incident adds a dated entry to [ai-lessons.md](ai-lessons.md) and, if
  preventable, a rule in `AGENTS.md` or a hook.
- Metrics: monthly count of `ai-assisted` PRs, `ai-bug` issues and reverts vs. total, recorded in the review.
- Monthly review (owner + backup): rules, permissions, hooks, MCP inventory, spend, lessons. Record the date and
  outcome at the bottom of this file via PR.

## Review log

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-29 | @Tushar180203 | Policy v1.0 created; guardrails, CI and config validation added |
