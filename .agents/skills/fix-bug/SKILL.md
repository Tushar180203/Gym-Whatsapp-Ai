---
name: fix-bug
description: Reproduce, fix and regression-test a bug in this repo. Use when the user reports a defect, a failing test, or wrong WhatsApp/web behaviour and gives a description, issue number or failing test path.
argument-hint: "<bug description | issue number | failing test path>"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(npx vitest run:*), Bash(npm run lint), Bash(npm run typecheck), Bash(npm test:*), Bash(npm run eval), Bash(git diff:*), Bash(git status:*), Bash(git log:*)
---

# Fix a bug

Input: $ARGUMENTS

1. Restate the bug and the expected behaviour; find the governing requirement in
   `specs/001-whatsapp-workout-companion/spec.md` (or say none exists — then ask before changing behaviour).
2. Locate the code with Grep/Glob. Read the closest `*.test.ts` to learn the local test style.
3. Write a failing regression test first (`npx vitest run <file> -t "<name>" --reporter=dot` must fail).
4. Make the smallest fix in the owning package (domain logic in `packages/domain`, never in `apps/web` routes).
5. AI-interpretation bug? Add an eval case to `packages/evals/fixtures/intent/` (constitution IX).
6. Add a dated line to `docs/ai-lessons.md` if the bug came from an earlier agent change.

## Verify (required)

- `npx vitest run <regression test file> --reporter=dot` passes.
- `npm run lint` and `npm test -- --reporter=dot` pass; run `npm run eval` if `packages/ai` or prompts changed.
- Report the root cause, the fix, the test added, and every check you ran or could not run.
