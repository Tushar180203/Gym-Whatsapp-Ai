@AGENTS.md

## Claude Code specifics

- Shared settings, permissions, sandbox and hooks live in `.claude/settings.json`; personal overrides go in
  `.claude/settings.local.json` or `CLAUDE.local.md` (both gitignored). Never add broad allows such as `Bash(*)`.
- Hooks in `.claude/hooks/` block destructive commands and secret reads, ask before editing CI/agent config,
  and re-run lint + related tests when you stop. If a hook blocks you, fix the cause; do not work around it.
- Skills: `.claude/skills` is a symlink to `.agents/skills` (single source for Codex and Claude).
- Use plan mode for multi-file or migration work; use subagents for broad searches to keep context small.
