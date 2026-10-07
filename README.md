# Gym-Whatsapp-Ai

## Deterministic Vertical Slice

This repository currently implements the first deterministic WhatsApp workout companion slice:

1. Create an authenticated user.
2. Set a preferred weight unit.
3. Create a routine with planned exercises.
4. Generate and consume a short-lived WhatsApp link token through a normalized inbound message.
5. Start a workout from the linked identity.
6. Log deterministic set notation.
7. Finish the workout.
8. Read persisted workout history.

### Local Commands

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
```

Use Node 22 LTS (`.nvmrc`). Production routes require `DATABASE_URL` and use PostgreSQL; the in-memory repository is only a fast test double.

## US5: Context, Records And Completion

Previous performance uses the latest completed/incomplete occurrence of the exact exercise identity (or confirmed alias), with the same unit and load semantics. PRs are calculated on demand from current non-deleted sets; no PR table or estimated 1RM exists.

`start` shows concise exercise targets and prior performance. `resume` keeps the same workout and exercise. `done` completes fully recorded/skipped work; partial workouts ask for `save completed`, `save incomplete`, `continue`, or `discard`. Empty workouts cannot be saved completed. Off-sequence, incomplete and discarded workouts do not advance the cursor.

Apply `packages/persistence/migrations/0003_us5.sql` once to an existing database already migrated through `0002_us4.sql` before starting the updated runtime. The application's `migrate()` method tracks and applies all three migrations for integration tests/new managed databases. The new migration persists pending finish choices and exercise-name snapshots; it does not persist PRs.

```bash
# Use a disposable test database; tests reset public tables and isolated test schemas.
TEST_DATABASE_URL=postgresql://user@localhost:5432/workout_test npm run test:postgres
TEST_DATABASE_URL=postgresql://user@localhost:5432/workout_test npm run test:us5:e2e
npm run eval
npm run build
npm run dev
```

HTTP finish accepts `{ "idempotencyKey": "unique-request-key", "requestedCompletion": "COMPLETE" }` (or `INCOMPLETE`, `CONTINUE`, `DISCARD`); omit the completion choice to request finish. Discard outside a pending finish choice asks for confirmation: submit a new request key to confirm, not a retry of the proposal key. Normal tests require no AI key or network; live Gemini evaluation remains opt-in. Natural-language history answers, analytics and later stories are not implemented in this pass.
