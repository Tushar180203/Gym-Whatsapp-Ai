---
name: verify-change
description: Run the right local checks for the current uncommitted change and report evidence. Use before declaring work done, before committing, or when asked "does this pass?".
argument-hint: "[optional: scope such as web, postgres, ai]"
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git diff:*), Bash(npm run lint), Bash(npm run typecheck), Bash(npm test:*), Bash(npx vitest run:*), Bash(npm run eval), Bash(npm run check:ai-config), Bash(npm run test:conversation)
---

# Verify a change

Scope hint: $ARGUMENTS

1. `git status --porcelain` and `git diff --stat` to see what changed.
2. Always: `npm run lint`, `npm test -- --reporter=dot`, `npm run check:ai-config`.
3. `packages/ai`, prompts or eval fixtures changed → `npm run eval`.
4. `packages/persistence` or SQL changed → ask the human for a disposable `TEST_DATABASE_URL`, then run the
   matching `tests/postgres/*.test.ts` file.
5. `apps/web` UI changed → ask to run the matching Playwright suite (`npm run test:*:web`).

## Output

A table: check · command · result (pass/fail/not run + reason). Paste at most the last 20 lines of any failure.
Never claim a check passed that was not executed (constitution XVIII).
