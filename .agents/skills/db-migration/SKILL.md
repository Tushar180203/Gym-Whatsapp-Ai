---
name: db-migration
description: Create a new ordered PostgreSQL migration and matching persistence changes. Use only when a human explicitly asks for a schema change. Manual-only because it changes database structure.
argument-hint: "<schema change description>"
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(ls packages/persistence/migrations:*), Bash(npm run lint), Bash(npx vitest run:*)
---

# Database migration (manual only)

Change: $ARGUMENTS

1. Confirm the requirement in `specs/001-whatsapp-workout-companion/data-model.md`; update it first if needed.
2. Create `packages/persistence/migrations/<next 4-digit number>_<snake_name>.sql`. Never edit an applied
   migration. Prefer additive changes; make destructive ones (drop/rename) a separate, explicitly approved step.
3. Update queries in `packages/persistence/src/` and the contracts/types that depend on them.
4. Add or update a `tests/postgres/*.test.ts` case that exercises the new schema on a populated database.
5. STOP and ask the human before running `npm run db:migrate` anywhere. Agents never run it against a
   non-disposable database.

## Verify (required)

- `npm run lint` passes.
- Ask the human to run, or with approval run, `TEST_DATABASE_URL=<disposable> npx vitest run tests/postgres/<file>.test.ts`.
- Report the migration file, rollback considerations and checks executed.
