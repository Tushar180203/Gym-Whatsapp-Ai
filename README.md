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

The automated vertical slice uses an in-memory repository behind the same domain boundary as the PostgreSQL schema. The production database contract for the slice is in `packages/persistence/migrations/0001_vertical_slice.sql`.
