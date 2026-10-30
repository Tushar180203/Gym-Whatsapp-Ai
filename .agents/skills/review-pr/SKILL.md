---
name: review-pr
description: Review a branch or PR diff against the constitution, specs and repo conventions. Use when asked to review changes, a PR number, or before opening a PR. Read-only; it never approves or merges.
argument-hint: "<PR number | branch | base..head range>"
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(gh pr view:*), Bash(gh pr diff:*), Bash(npm run lint), Bash(npm test:*), Bash(npx vitest run:*)
---

# Review changes

Target: $ARGUMENTS

Check, citing `file:line`:
1. Traceability: links to a spec requirement, task ID (`T###`), bug or ADR (constitution XVII).
2. AI boundaries: AI output validated by `packages/contracts`, never mutates state directly (III, IV).
3. Tests/evals added for changed behaviour; no `.skip`/`.only`/weakened assertions (X, XVIII).
4. Security/privacy: no secrets, no PII in logs or prompts, webhook verification intact (XII).
5. Size: > 400 changed lines → recommend a split (XVI). AI-assisted commits carry a `Co-Authored-By` trailer.
6. New dependencies: justified, exact version, reputable publisher.

## Verify (required)

Run `npm run lint` and `npm test -- --reporter=dot` on the checked-out branch and include the results.
Output: findings ordered by severity, then the PR template checklist with each box marked. Never approve or merge.
