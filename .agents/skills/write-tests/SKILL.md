---
name: write-tests
description: Add or extend Vitest tests for a module, behaviour or eval scenario. Use when asked to improve coverage, add missing tests for a file, or turn a known failure into a regression test.
argument-hint: "<file, module or behaviour to test>"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(npx vitest run:*), Bash(npm run lint), Bash(npm test:*)
---

# Write tests

Target: $ARGUMENTS

1. Read the target and its existing tests; list the behaviours and edge cases that lack coverage.
2. Put unit tests beside the code (`*.test.ts`); DB-backed tests go in `tests/postgres/` and must guard on
   `TEST_DATABASE_URL`; AI behaviour goes in `packages/evals/fixtures/intent/*.yaml`.
3. Use synthetic data only: `@example.com` emails, `+1555…` numbers, no real names or chats.
4. Assert behaviour and forbidden mutations, not exact conversational copy.
5. Never add `.skip`, `.only`, or weaken existing assertions.

## Verify (required)

- `npx vitest run <new test files> --reporter=dot` passes, and fails if you revert the behaviour under test.
- `npm run lint` passes. Report which behaviours are now covered.
