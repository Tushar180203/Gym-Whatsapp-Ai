# Human Release Review

Date: 2026-10-07. This is a release gate, not a new product specification.
Status: ready for human review; NOT approved for public production release.

Ownership linking evidence (2026-10-08): number-bound verification, consent/change/revoke, verified command/recipient gates, atomic authenticated-sender encryption and welcome/plan-ready idempotency implemented. Migration 0009 preserves proven links and invalidates unbound outstanding tokens. PostgreSQL 102/102, real website desktop/mobile ownership 2/2, existing onboarding 5/5 and release browser 2/2 pass; see validation-results.md. Configure public WHATSAPP_BUSINESS_NUMBER before live linking. Live Meta acceptance is still unrun; physical erasure/backups/retention/propagation and hosting/provider processing decisions remain unresolved. No Phase C or public-release approval.

## Required Decisions

User-confirmed transport activation blocker (2026-10-08): no business WhatsApp destination currently available. WHATSAPP_BUSINESS_NUMBER remains unset; Phone Number ID is not deliverable addressing. Controlled verification is complete, live linking remains blocked. Do not provision a number or invent a destination as part of this task.

- [ ] Review Phase A R1/R3 and Phase B controlled transport R2 evidence; perform opt-in live Meta/handset acceptance separately. Controlled HTTP success and provider acceptance do not imply real handset delivery.
- [ ] Decide physical erasure, backup erasure, retention duration and deletion propagation. Current deletion is soft/inaccessibility only; records and operational bodies can remain stored. No GDPR/CCPA compliance claim.
- [ ] Approve external Gemini/WhatsApp data processing and free-tier project handling before real user data; model smoke used synthetic input only.
- [ ] Review development dependency advisories and choose a separately tested major toolchain upgrade. Never expose Vitest/Vite/esbuild development servers.
- [ ] Choose hosting, HTTPS origin, trusted edge throttling/body limits, database privileges/TLS, secret injection and access-controlled logs. Local rate limits reset on restart and are not multi-instance quotas.
- [ ] Review migration 0008 legacy quarantine and safe operator report; reconcile external evidence manually, never blindly replay historical SENT.
- [ ] Human review/merge approval of security, migrations, deletion-receipt exception and remaining unchecked tasks.

## Configuration And Startup

Use Node 22 LTS and npm 10+, then `npm ci`. .env is ignored; .env.example contains placeholders only.
Required runtime values: DATABASE_URL, GEMINI_API_KEY, WHATSAPP_APP_SECRET; AI_PROVIDER defaults to gemini, AI_MODEL defaults to gemini-3.5-flash-lite.
WHATSAPP_PROVIDER defaults to disabled. Enabling cloud_api also requires WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_RECIPIENT_ENCRYPTION_KEY (64 hex) and WHATSAPP_GRAPH_API_VERSION. Startup validates these without printing values. Provider-private addressing is authenticated encrypted storage; custody/rotation still needs production review. See phase-b-transport.md.
APP_ORIGIN must be the canonical HTTPS origin in production. No paid provider fallback is configured.
Session credentials are random, stored hashed; passwords use scrypt. No additional AUTH_SECRET is required by this design.
Do not put production secrets in build args, source, test fixtures or client environment variables.

```bash
# Inject environment using the approved hosting secret mechanism.
npm run check:runtime
npm run db:migrate
npm run build
npm start
```

`npm start` validates configuration with production HTTPS requirements before starting Next.
`check:runtime` reports missing/invalid variable names only, never values. The migration command needs DATABASE_URL only.
For local development set an HTTP APP_ORIGIN matching the actual port and run `npm run dev -- --hostname 127.0.0.1 --port 3000`.
Current screens: /onboarding, /routines, /history, /history/:workoutId, /analytics, /settings/data.
Onboarding creates a secure session, saves preferences and uses real configuration APIs; saved sessions can configure routines/select workouts.
A returning-user password sign-in surface remains outside this Phase A pass; do not claim it exists.

## Database Rollout

Run migrations from repository root with a privileged migration-only connection in a controlled job.
Use npm ci including development dependencies in that job; tsx is an explicit migration runner, not domain architecture.
Serving processes must not run migrations automatically. Use a separate least-privilege runtime DB role.
Stop mutation traffic, take an access-controlled backup and test restore in staging before upgrade.
All migrations 0001 through 0008 apply in order. 0006 adds relational ownership/context constraints and indexes; 0007 adds configuration/schedule/archive metadata, cursor versions and deferred sequence-position uniqueness; 0008 adds protected recipients, attempt/receipt state and quarantines false legacy SENT without replay.
The migration ledger and advisory lock serialize concurrent migration attempts. Migration batch is transactional; errors roll back.
0006 deliberately fails if existing owner/parent/cursor relationships are inconsistent. Investigate corruption; do not delete rows or disable constraints to get a green migration.
Confirmed identity merge consistency is deferred until transaction commit, not removed.
Legacy adoption of 0001 assumes the exact original schema. Arbitrary/manual/partially migrated schemas are not supported by the tested upgrade path.
No automatic down migration exists: rehearse restore and application compatibility before rollback. No retention promise is implied by backups.

## Failure And Operations

- Auth failures return safe authentication errors; foreign object IDs return not found. Logs never require request content/credentials/provider raw bodies.
- Webhook input is bounded to 1 MiB, authenticated before JSON interpretation, structurally validated and processed in provider-batch order. Independent concurrent deliveries serialize per owner, but no provider timestamp reordering guarantee exists.
- AI failures roll back the inbound transaction. Provider retries can try again without durable duplicate commands/sets. Schema/refusal/authentication failures are not model permission or fallback mutations.
- Exact message ID replay revalidates sender identity; same-user concurrent commands use PostgreSQL transaction locks. Deleted users and prior data-generation facts remain blocked.
- Responses persist PENDING, reserve SENDING, and become SENT only with Meta acceptance evidence. Delivery receipts are separate metadata. Safe rejected attempts retry on request/manual invocation with backoff and three-attempt cap. Timeout/unknown and legacy quarantine never automatically replay. The controllable provider suite verifies the path; real Meta/handset acceptance remains opt-in/outstanding.
- Safe signals include webhook/request failures, duplicates, processing/AI/path timing and outbound attempt/result/failure with internal IDs. Full confirmation signals and deterministic p95 timing remain incomplete. No raw text/recipient required in routine logs.
- Pilot limits: auth entry 20/minute process-wide, writes 120/minute session hash, inbound 120/minute provider-scoped identity hash, AI fallback 20/minute owner. Bounded maps fail closed at capacity. Edge throttling is required before public exposure; auth global throttling is conservative, not a resolved per-client proxy policy.
- Exports are synchronous portable JSON snapshots, allowlisted and owner-scoped. Large histories can consume memory; no background worker or pagination redesign was added. Agree pilot history/request size budgets before release.
- History list loads sets in one bulk query rather than one query per workout. Analytics remain deterministic on-demand snapshots. Performance SLOs have NOT been load-tested.

## Reviewer Evidence

See validation-results.md for exact commands, test counts, retries and limitations.
See traceability-review.md for every functional requirement and CHK001-CHK044 implementation evidence.
The browser suites inspect 1280px and 390px layouts; explicit focus/keyboard checks cover analytics tabs and destructive native dialogs. This is not a full accessibility certification.
Staged/tracked secret checks and dependency audit are point-in-time evidence, not a security certification.
