## What and why

<!-- Link the requirement/task (spec section, T### id, issue or ADR). -->

Traceability:

## AI assistance

- [ ] No AI tool was used
- [ ] AI-assisted — tool(s): <!-- Codex / Claude Code / other --> · commits carry `Co-Authored-By:` · PR labelled `ai-assisted`
- [ ] I reviewed every AI-generated line and can explain it

## Verification evidence

<!-- Paste command + result (last lines only). Say what was NOT run and why. -->

| Check | Command | Result |
|---|---|---|
| Lint / typecheck | `npm run lint` | |
| Tests | `npm test -- --reporter=dot` | |
| AI evals (if `packages/ai`, prompts or fixtures changed) | `npm run eval` | |
| PostgreSQL (if persistence/SQL changed) | `npm run test:postgres` | |
| Web e2e (if UI changed) | `npm run test:*:web` | |
| AI config (if agent config changed) | `npm run check:ai-config` | |

## Reviewer checklist

- [ ] Change is ≤ ~400 lines or split justification given
- [ ] Tests/evals added or updated for changed behaviour; nothing skipped or weakened
- [ ] AI output validated by `packages/contracts`; no direct state mutation by AI
- [ ] No secrets, real personal data or production data; logs/prompts carry no PII
- [ ] New dependencies justified, exact version, trusted publisher, compatible licence
- [ ] Migrations are new files (no edits to applied ones) and are additive or explicitly approved
