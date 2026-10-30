# Architecture overview

Short map for humans and agents. Full detail: [plan.md](../specs/001-whatsapp-workout-companion/plan.md),
[data-model.md](../specs/001-whatsapp-workout-companion/data-model.md),
[contracts/](../specs/001-whatsapp-workout-companion/contracts/), decisions in [adr/](adr/README.md).

## Shape

Modular monolith: one Next.js 16 app (`apps/web`) serves the web product, JSON APIs and WhatsApp webhooks, on top of
shared TypeScript packages. PostgreSQL is the only datastore. No queues or microservices in the MVP.

```text
WhatsApp Cloud API ──webhook──▶ apps/web/app/api/webhooks ──▶ packages/messaging (verify, normalise)
Browser ──────────────────────▶ apps/web/app (routes, API) ─┐
                                                            ▼
                         packages/domain (conversation orchestrator, workouts, corrections)
                          │             │                         │
              packages/ai (Gemini,   packages/contracts      packages/analytics
              structured intents)    (Zod validation)        (deterministic PRs/stats)
                                        │
                              packages/persistence (pg + SQL migrations) ──▶ PostgreSQL
```

## Invariants

- AI proposes structured actions; `packages/contracts` validates them; only domain commands mutate state.
- Analytics and PRs are computed deterministically from stored sets, never by the model.
- Provider details stay inside `packages/ai` and `packages/messaging` adapters.
- Webhooks verify signatures and are idempotent (replay-safe).

## Testing layers

Vitest unit tests beside code · `tests/integration` (in-memory) · `tests/postgres` (disposable DB) ·
`tests/e2e` Playwright · `packages/evals` AI eval fixtures (mocked provider by default).
