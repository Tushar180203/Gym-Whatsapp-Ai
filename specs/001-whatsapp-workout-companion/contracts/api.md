# Contract: Web And API Surface

This contract describes product interfaces, not implementation code. All endpoints require authenticated user context unless explicitly marked public.

## Authentication And Profile

- `POST /api/auth/signup`: creates account.
- `POST /api/auth/logout`: requires an authenticated session, invalidates the current session, returns a safe success result, treats repeated logout as harmless/idempotent where appropriate, and does not delete the account or workout data.
- `GET /api/profile`: returns profile and preferences.
- `PATCH /api/profile`: updates minimal workout-tracking preferences such as preferred weight unit.

PATCH accepts strict `{ preferredWeightUnit: "KG" | "LB", displayName?: string | null }`.
The approved UserProfile displayName is persisted and returned, preserved when omitted, and cleared by null.
Unknown/owner fields are rejected; the authenticated session supplies the owner.

## WhatsApp Linking

- `POST /api/whatsapp/link-token`: authenticated explicit challenge creation, strict `{ phoneNumber: "+countrycode...", consent: true, change?: boolean }`. International normalization never guesses a country. Returns `{ token, challengeId, expiresAt, maskedNumber, whatsappUrl }` once. Code is 128-bit random, case-insensitive, hashed at rest, valid for ten minutes. A new code supersedes the prior PENDING challenge. At most ten creations per owner per ten minutes. Existing verified links require explicit `change: true`, and remain usable until a different number proves ownership. The same already-verified number cannot create another challenge.
- `GET /api/whatsapp/link`: authenticated, private no-store `{ status, verified, pending, links }`. Status is NOT_CONNECTED/PENDING/VERIFIED/REVOKED; verified and pending replacement may coexist. Only masked numbers, timestamps and owner-scoped IDs are returned. No code, expected hash or raw recipient is returned; reload never issues a code.
- `DELETE /api/whatsapp/link/:id`: authenticated strict `{ confirm: true }`, owner-scoped idempotent disconnect. Revokes the link, invalidates pending challenges and removes its unused deliverable address. Replaying an already-revoked link cannot revoke a later link or erase another owner's recipient.

Typed number is CLAIMED, not proof. Only `LINK <code>` from an authenticated matching Meta sender can consume the challenge and establish VERIFIED ownership. No public web verification endpoint, phone login, account recovery or automatic identity transfer. Final encrypted addressing is derived from that webhook sender, not the form. Public `WHATSAPP_BUSINESS_NUMBER` supplies wa.me destination; it is not the provider phone-number ID.

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
- POST/PATCH configuration is `{ name, schedule?: { intendedWorkoutsPerWeek?, plannedDays? }, sessions: [{ id?, name, exercises: [{ exerciseIdentityId, plannedSetCount, repTargetMin, repTargetMax? }] }] }`. Days are MON through SUN; equal min/max represents an exact target. Omitted max uses min. Positive counts/ranges and existing session ownership are validated locally.
- PATCH requires `expectedVersion`. Changing existing session order/membership also requires explicit `confirmSequenceChange: true`; exact sequence reordering uses the existing versioned PendingConfirmation command policy. The cursor retains its next identity when present; planned calendar metadata never skips it. Existing snapshots and referenced historical planned rows remain unchanged.
- DELETE requires `{ expectedVersion, confirm: true }`, archives the owned routine, and refuses an active/proposed/paused workout. No history is deleted.

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
- Custom POST accepts `{ name, defaultLoadSemantics, confirm: true }`; alias POST accepts `{ alias, confirm: true }`. Both use the existing confirmation framework. Conflicting aliases return clarification, not a new identity or implicit merge.
- Rename PATCH accepts `{ displayName, expectedVersion }` for a private owned identity, preserving its ID and history. Global definitions cannot be renamed by a user.
- Merge POST accepts `{ fromExerciseId, toExerciseId, confirm: true }` for two distinct owned identities and reuses the existing explicit merge confirmation framework. No automatic merge is performed.
- Classification PATCH accepts `{ classifications: [{ muscleGroup, role, status }] }` (up to 20 unique muscle/role rows). Roles are `PRIMARY`/`SECONDARY`; statuses are `CONFIRMED`/`UNCERTAIN`/`UNCLASSIFIED`. This replaces only the authenticated user's classifications for an accessible exact identity; foreign custom identity IDs return not found. Manual confirmation, not an AI hint, controls inclusion.

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
- Start POST accepts `{ kind, idempotencyKey, routineRef?, sessionRef?, workoutId?, expectedVersion?, confirmationId? }`. Kinds are START, ACCEPT, CHOOSE, REST, REPLACE, CONFIRM. START proposes (PROPOSED), ACCEPT explicitly activates the current proposal, CHOOSE proposes an exact alternative for today, REST dismisses a proposal without advancing the cursor. Multiple plausible routines/sessions clarify without creating a workout. The response includes the full planned list and current owned workout/version.
- REPLACE requires the exact active workout/version and selected session. It creates an existing PendingConfirmation; CONFIRM requires that owner's exact confirmation ID and revalidates versions before atomic replacement. AI START_WORKOUT cannot accept or replace a session. PATCH workout uses the same selection contract with the path's owned workout ID/version.
- Set POST accepts `{ notation, expectedVersion, idempotencyKey }`, requires an active owned workout and profile unit, and uses the deterministic parser. DELETE accepts `{ expectedVersion, idempotencyKey }` to propose removal, then a new key plus `{ confirm: true, confirmationId }` to resolve it. Foreign IDs and stale versions cannot authorize mutations; completed command retries reuse prior results.

## Analytics And History

- `GET /api/analytics/overview`
- `GET /api/analytics/muscles`
- `GET /api/analytics/exercises/:exerciseId`
- `GET /api/history/questions/supported`

Rules:

- Analytics are deterministic and derived from persisted data.
- Primary-muscle sets only for MVP muscle counts.
- Responses use UTC Monday-start weeks/calendar months. Frequency, completed count and monthly count include only completed workouts; muscle sets/progression/last-trained include current recorded sets in completed/incomplete workouts, excluding deleted sets and discarded/active sessions.
- Overview returns periods, counts, weekly frequency, muscle counts/last-trained, exact raw progression and accessible identities/user-private classifications. Muscles returns the same period metadata and muscle rows. Exercise detail returns the exact accessible identity, raw progression and deterministic compatible US5 best-set text. Supported questions returns the six bounded query kinds and UTC calendar; it does not generate factual answers.
- Queries require a valid owner session, re-check deleted-user blocking and return private no-store responses. No AI-generated numeric values, cached PRs, estimated 1RM or coaching prescriptions are returned.

## Export And Deletion

- `POST /api/data/export`
- `GET /api/data/export/:requestId`
- `POST /api/data/delete-request`
- `POST /api/data/delete-request/:requestId/confirm`

Rules:

- Export and deletion requests are user-owned.
- Deletion requires confirmation.
- POST export accepts only `{ idempotencyKey }`. Small-account export is synchronous and atomic: the durable request transitions to `COMPLETED` with `requestedAt`, `completedAt`, a versioned portable JSON result and an authenticated result location. Duplicate owner/key requests reuse the record; foreign owner fields are rejected.
- GET export returns `{ request, data }` only to its active authenticated owner. `?download=1` downloads `workout-export.v1` as JSON. Internal credentials, provider secrets/identity hashes, raw auth/link tokens, inbound chat payloads and operational command records are excluded. Referenced shared exercise definitions may be included; unrelated users' definitions are not.
- POST delete-request accepts only `{ idempotencyKey, type }`, where type is `DELETE_ACCOUNT` or `DELETE_WORKOUT_DATA`. Owner comes from the secure session. It creates `AWAITING_CONFIRMATION` with a ten-minute expiry and a fingerprint of the target data. A second pending deletion is rejected; duplicate keys reuse their original result.
- POST confirm accepts only `{ confirm: true }`. Ownership, active authentication, expiry and target fingerprint are revalidated under the per-user transaction lock. Changed targets become `STALE`; expired requests become `EXPIRED`; neither executes. Completed requests replay without applying deletion again. Request metadata includes owner, type, requested/confirmed/completed times, status and safe operation/count summaries.
- Workout-data deletion makes recorded sessions/sets/corrections inaccessible, excludes them from history/PRs/previous performance/analytics/questions and revokes prior export snapshots. Routine templates, exercise definitions, classifications and preferences remain. The existing `DISCARDED` session state plus a storage-only deletion marker and deleted set state implement soft deletion; no retention or secure-erasure commitment is added.
- Account deletion additionally persists `User.deletedAt`, invalidates all auth sessions, revokes links and consumes outstanding link tokens. New commands and replayed webhooks cannot return old workout facts or mutate the deleted account. Shared/global definitions and other users remain intact.
- Email uniqueness applies to active users as specified by the User model; registering a deleted account's email creates a distinct owner with no inherited history, credentials or request authority.
- The original unexpired session credential may retrieve only its exact already-completed account-deletion confirmation receipt, despite invalidation. This is a terminal no-write replay, not renewed authentication; it cannot request exports, read workout data, or authorize another request. All execution still requires a live authenticated owner. Data-control routes do not invoke AI.

## Webhook

- `GET /api/webhooks/whatsapp`: public provider verification endpoint.
- `POST /api/webhooks/whatsapp`: public provider callback endpoint.

Rules:

- POST requires provider signature verification.
- Provider message ids are deduplicated within the provider account.
- Linked-user lookup uses `(provider, providerAccountId, providerUserIdentityHash)`; `providerAccountId` alone is not an end-user identity.
- Provider-specific details stay outside workout domain logic.
- GET requires single subscribe/token/numeric-challenge fields and returns plain challenge only after constant-time verification. Wrong token 403, malformed request 400, missing configuration 503. POST status receipts use the same authenticity gate and only update delivery metadata. See messaging.md and phase-b-transport.md for attempt/retry semantics; HTTP acknowledgement is not delivery evidence.
