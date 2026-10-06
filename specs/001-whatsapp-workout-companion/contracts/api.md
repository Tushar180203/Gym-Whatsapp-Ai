# Contract: Web And API Surface

This contract describes product interfaces, not implementation code. All endpoints require authenticated user context unless explicitly marked public.

## Authentication And Profile

- `POST /api/auth/signup`: creates account.
- `GET /api/profile`: returns profile and preferences.
- `PATCH /api/profile`: updates minimal workout-tracking preferences such as preferred weight unit.

## WhatsApp Linking

- `POST /api/whatsapp/link-token`: creates a short-lived link token/code.
- `GET /api/whatsapp/link`: shows current link status.
- `DELETE /api/whatsapp/link/:id`: revokes link.

## Routines

- `GET /api/routines`
- `POST /api/routines`
- `GET /api/routines/:routineId`
- `PATCH /api/routines/:routineId`
- `DELETE /api/routines/:routineId`

Rules:

- All routine resources are scoped by owner.
- Editing routine templates affects future sessions only.
- Completed workout history is never rewritten by routine edits.

## Exercises And Aliases

- `GET /api/exercises`
- `POST /api/exercises/custom`
- `PATCH /api/exercises/:exerciseId`
- `POST /api/exercises/:exerciseId/aliases`
- `PATCH /api/exercises/:exerciseId/classification`
- `POST /api/exercises/merge-request`

Rules:

- Custom exercise identity remains stable across rename and alias changes.
- Merges require explicit confirmation.
- Confirmed primary-muscle classification controls MVP muscle analytics.

## Workout Sessions And Sets

- `GET /api/workouts/active`
- `POST /api/workouts/start`
- `POST /api/workouts/:workoutId/resume`
- `POST /api/workouts/:workoutId/finish`
- `POST /api/workouts/:workoutId/discard`
- `GET /api/workouts/history`
- `GET /api/workouts/:workoutId`
- `PATCH /api/workouts/:workoutId`
- `POST /api/workouts/:workoutId/sets`
- `PATCH /api/workouts/:workoutId/sets/:setId`
- `DELETE /api/workouts/:workoutId/sets/:setId`

Rules:

- At most one active workout per user.
- Set edits and deletes apply only after ownership and correction rules pass.
- Completed-history edits recalculate PR and analytics outputs.

## Analytics And History

- `GET /api/analytics/overview`
- `GET /api/analytics/muscles`
- `GET /api/analytics/exercises/:exerciseId`
- `GET /api/history/questions/supported`

Rules:

- Analytics are deterministic and derived from persisted data.
- Primary-muscle sets only for MVP muscle counts.

## Export And Deletion

- `POST /api/data/export`
- `GET /api/data/export/:requestId`
- `POST /api/data/delete-request`
- `POST /api/data/delete-request/:requestId/confirm`

Rules:

- Export and deletion requests are user-owned.
- Deletion requires confirmation.

## Webhook

- `GET /api/webhooks/whatsapp`: public provider verification endpoint.
- `POST /api/webhooks/whatsapp`: public provider callback endpoint.

Rules:

- POST requires provider signature verification.
- Provider message ids are deduplicated.
- Provider-specific details stay outside workout domain logic.
