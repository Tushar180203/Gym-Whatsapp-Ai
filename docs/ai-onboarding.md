# AI Tooling Onboarding

Read [ai-policy.md](ai-policy.md) first. Owner: see [CODEOWNERS](../.github/CODEOWNERS).

## One-time setup

1. Node 22 (`nvm use`), then `npm ci`. `npm ci` runs `prepare`, which sets `git config core.hooksPath .githooks`
   (pre-commit: AI config check, secret scan, lint; pre-push: tests).
2. Install `gitleaks` (`brew install gitleaks` or the GitHub release binary) so the pre-commit secret scan uses it;
   without it a built-in pattern scan runs instead.
3. Linux sandbox for Claude Code: `sudo apt install bubblewrap socat`.
4. Sign in to Codex / Claude Code with your **FiftyFive org account** only.
5. Personal tweaks go in `.claude/settings.local.json`, `CLAUDE.local.md` or `~/.codex/config.toml` (gitignored /
   outside the repo). Never commit broad allow rules.

## Daily use

| Need | Use |
|---|---|
| New feature | `speckit-specify` → `speckit-clarify` → `speckit-plan` → `speckit-tasks` → `speckit-analyze` → `speckit-implement` |
| Bug | `fix-bug <description>` |
| Tests | `write-tests <file or behaviour>` |
| Before commit | `verify-change` (or `npm run verify`) |
| Review | `review-pr <PR number or branch>` |
| Schema change | `/db-migration <change>` (manual only) |

- One task per session; `/clear` (Claude) or a new session (Codex) between tasks; plan mode for multi-file work.
- Hooks will block destructive commands and ask before editing CI or agent config. That is expected.
- Commit with a `Co-Authored-By:` trailer when an agent helped; label the PR `ai-assisted`.
- If an agent makes a mistake worth preventing, add it to [ai-lessons.md](ai-lessons.md) and propose a rule/hook.

## Validate your setup

`npm run check:ai-config` and `npm test -- tests/ai-config --reporter=dot` must both pass.
