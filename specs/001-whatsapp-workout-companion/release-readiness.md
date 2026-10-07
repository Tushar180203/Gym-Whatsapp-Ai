# Human Release Review

Date: 2026-10-07. This is a release gate, not a new product specification.
Status: ready for human review; NOT approved for public production release.

## Required Decisions

- [ ] Review and resolve R1-R3 in traceability-review.md: incomplete approved setup/start/transport paths. Do not provision production WhatsApp as part of this pass.
- [ ] Decide physical erasure, backup erasure, retention duration and deletion propagation. Current deletion is soft/inaccessibility only; records and operational bodies can remain stored. No GDPR/CCPA compliance claim.
- [ ] Approve external Gemini/WhatsApp data processing and free-tier project handling before real user data; model smoke used synthetic input only.
- [ ] Review development dependency advisories and choose a separately tested major toolchain upgrade. Never expose Vitest/Vite/esbuild development servers.
- [ ] Choose hosting, HTTPS origin, trusted edge throttling/body limits, database privileges/TLS, secret injection and access-controlled logs. Local rate limits reset on restart and are not multi-instance quotas.
- [ ] Reconcile old falsely SENT outbound records before enabling any delivery adapter; do not blindly replay them.
- [ ] Human review/merge approval of security, migrations, deletion-receipt exception and remaining unchecked tasks.

## Configuration And Startup

Use Node 22 LTS and npm 10+, then `npm ci`. .env is ignored; .env.example contains placeholders only.
Required runtime values: DATABASE_URL, GEMINI_API_KEY, WHATSAPP_APP_SECRET; AI_PROVIDER defaults to gemini, AI_MODEL defaults to gemini-3.5-flash-lite.
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
Current implemented review screens: /history, /history/:workoutId, /analytics, /settings/data.
They require a valid session; a complete returning-user sign-in/onboarding/routine UI is not available in this checkout.

## Database Rollout

Run migrations from repository root with a privileged migration-only connection in a controlled job.
Use npm ci including development dependencies in that job; tsx is an explicit migration runner, not domain architecture.
Serving processes must not run migrations automatically. Use a separate least-privilege runtime DB role.
Stop mutation traffic, take an access-controlled backup and test restore in staging before upgrade.
All migrations 0001 through 0005 apply in order; 0006 adds only relational ownership/context constraints and query indexes.
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
- Responses persist as PENDING until real send evidence exists. Actual transport/send retry lifecycle is absent; JSON HTTP responses are not WhatsApp delivery.
- Safe signals currently include webhook/request failures, duplicates, processing/AI failures and path markers/AI timing. Full confirmation/outbound lifecycle signals and deterministic p95 timing remain incomplete. No raw text required in routine logs.
- Pilot limits: auth entry 20/minute process-wide, writes 120/minute session hash, inbound 120/minute provider-scoped identity hash, AI fallback 20/minute owner. Bounded maps fail closed at capacity. Edge throttling is required before public exposure; auth global throttling is conservative, not a resolved per-client proxy policy.
- Exports are synchronous portable JSON snapshots, allowlisted and owner-scoped. Large histories can consume memory; no background worker or pagination redesign was added. Agree pilot history/request size budgets before release.
- History list loads sets in one bulk query rather than one query per workout. Analytics remain deterministic on-demand snapshots. Performance SLOs have NOT been load-tested.

## Reviewer Evidence

See validation-results.md for exact commands, test counts, retries and limitations.
See traceability-review.md for every functional requirement and CHK001-CHK044 implementation evidence.
The browser suites inspect 1280px and 390px layouts; explicit focus/keyboard checks cover analytics tabs and destructive native dialogs. This is not a full accessibility certification.
Staged/tracked secret checks and dependency audit are point-in-time evidence, not a security certification.
