# Technical Research: WhatsApp Workout Companion

**Feature**: [spec.md](./spec.md)  
**Date**: 2026-10-06

## Decision: Use An End-To-End TypeScript Monorepo

**Rationale**: The product has two interaction surfaces but one domain. TypeScript lets web UI, API handlers, WhatsApp interpretation, structured AI schemas, persistence access, analytics, and tests share types and validation contracts. A monorepo keeps the workout domain reusable without duplicating business rules across separate products.

**Alternatives considered**:

- Separate web and WhatsApp services: rejected for MVP because it increases duplication and coordination around the same workout state.
- Python backend plus TypeScript frontend: viable, but adds cross-language schema drift without a current need.
- Microservices: rejected because the spec requires correctness and boundaries, not independent scaling.

## Decision: Use PostgreSQL As The Primary Database

**Rationale**: The domain requires relational consistency, ownership checks, historical workout records, routine snapshots, corrections, aliases, one-active-workout enforcement, idempotency, and analytics queries. PostgreSQL supports transactions, row-level locks, partial unique indexes, JSON metadata when needed, and strong query support for deterministic analytics.

**Alternatives considered**:

- Document database: rejected because aliases, routines, sessions, sets, corrections, analytics, and ownership are relational and need constraints.
- Event store as primary database: rejected for MVP complexity. Audit and correction history can be modeled relationally first.
- In-memory/session storage: rejected because workout history is durable product value.

## Decision: Use Typed Relational Access With Prisma Or Drizzle

**Rationale**: The project needs type-safe database access and migrations in TypeScript. Either Prisma or Drizzle can satisfy this. The plan leaves the final choice open because no application source exists yet and both fit the requirements.

**Alternatives considered**:

- Raw SQL only: rejected for MVP because shared typed access reduces accidental schema drift.
- Full repository abstraction everywhere: rejected as a default. Use focused repositories/query services where they protect domain boundaries.

### Implementation Decision: npm Workspaces And Drizzle

**Decision**: Use npm workspaces for the monorepo and Drizzle for typed PostgreSQL access.

**Rationale**: npm is already available in the target Node environment and keeps the first vertical slice lightweight. Drizzle fits the SQL-first persistence model, partial unique index needs, migration reviewability, and TypeScript ergonomics without requiring a generated client during early slice work.

**Vertical-slice note**: The first deterministic slice includes a reviewed SQL migration and an in-memory repository implementation for automated tests in this environment. The repository boundary is intentionally shaped around the PostgreSQL/Drizzle schema so the slice can run without a live database while preserving the approved relational constraints for production wiring.

## Decision: Use First-Party Secure Session Auth For The Vertical Slice

**Rationale**: The first deterministic slice needs real authenticated user context, secure session tokens, logout/session invalidation, and ownership checks before provider identity linking can be trusted. A first-party session service using high-entropy bearer tokens, hashed session storage, password hashing, expiry, invalidation, and owner guards satisfies the slice without coupling the domain to a hosted auth provider.

**Alternatives considered**:

- Mock auth: rejected because the vertical slice must prove real ownership and cross-user isolation.
- External hosted auth provider: deferred until deployment/provider requirements are finalized; the session boundary can later be backed by a provider without changing domain ownership rules.

## Decision: Use Official WhatsApp Business Platform / Cloud API Behind A Messaging Interface

**Rationale**: Direct Cloud API integration avoids unnecessary aggregator coupling for MVP and supports official webhook and outbound-message flows. The messaging adapter owns provider verification, provider payload formats, outbound message constraints, service-window/template behavior, and provider errors. Domain code sees normalized messages and outbound response intents only.

**Alternatives considered**:

- Twilio or another aggregator: may simplify setup and phone-number operations, but adds cost and another provider contract. Keep as a later option if direct Meta setup blocks delivery.
- Manual WhatsApp Web automation: rejected because it is brittle and inappropriate for production.

## Decision: Use Deterministic Fast-Path Parsing Before AI

**Rationale**: Many in-gym inputs are structured enough to parse without a model call. Examples such as `45x10`, `45 kg x 10`, `45 each 10`, and comma-separated sets can be parsed deterministically when active exercise context is safe. This lowers latency, cost, and AI error exposure while matching the constitution.

**Alternatives considered**:

- AI for every message: rejected because it violates simplicity and justified-AI principles.
- Deterministic parsing only: rejected because the spec requires messy language, aliases, corrections, and bounded questions that benefit from interpretation.

## Decision: AI Returns Structured Proposed Actions Only

**Rationale**: The AI layer should interpret ambiguity, not mutate state. Local schemas define action discriminants and fields. The application layer validates schema, authorization, context, confirmation policy, and domain invariants before executing commands.

**Alternatives considered**:

- Free-form AI replies with post-hoc parsing: rejected because it is hard to validate and audit.
- Tool-calling directly into persistence: rejected because AI must not be final authority on durable state.

## Decision: Recommend Strict Structured Output Support For Initial AI Provider

**Rationale**: The implementation needs JSON-schema-shaped action outputs, local validation, versioned schemas, and regression tests. Gemini Developer API supports structured JSON output and is the initial free-tier MVP provider. The provider remains behind a local interface so the domain does not depend on Gemini response formats. Provider schema subsets never replace the complete local Zod contract.

**Alternatives considered**:

- Provider-neutral text-only completions: rejected because the action contract needs structured outputs.
- Local model only: not chosen for MVP because reliability, latency, and operational effort are unknown.

## Decision: Initial MVP AI Adapter Uses Gemini Developer API Free Tier

**Rationale**: Gemini Developer API is the initial MVP provider because development must use a free AI option. Google's pricing lists free input/output for `gemini-3.5-flash-lite`, and its model documentation supports structured outputs for classification/extraction. Configure `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and `AI_MODEL` (default `gemini-3.5-flash-lite`). The REST adapter remains behind `StructuredOutputClient`; `IntentInterpreter` and workout domain types remain provider-independent. All output is validated against existing local Zod schemas after provider JSON decoding. Gemini's supported schema subset omits unsupported constraints (including boolean literals), which remain enforced locally. Normal tests/evals use mocks; live Gemini smoke tests remain explicitly opt-in. Offline evals establish boundary behavior, not live model accuracy.

**Free-tier constraints**: Use an unbilled free-tier project; model selection alone cannot guarantee the billing tier. Free-tier quotas/availability are account-dependent, and quota failures surface as local rate-limit errors with no paid fallback. Google's free-tier pricing states data may be used to improve its products; use synthetic/non-sensitive data for development and review those terms before sending real user workout/chat data. API keys and raw provider errors are never included in routine logs.

**Model availability**: Google's current model page limits Gemini 2.5 access to existing users and directs new projects to newer models. The default therefore uses the stable, free-tier-compatible `gemini-3.5-flash-lite`. Explicit `AI_MODEL` overrides remain available for account-specific supported models; runtime does not automatically change models on quota or access errors.

**Verified transport compatibility**: Live synthetic probes confirmed that this
Gemini endpoint accepts `generationConfig.responseMimeType=application/json` and
`generationConfig.responseSchema`, but rejects `application/json` under
`responseFormat.text.mimeType`. Its native Schema rejects `additionalProperties`.
Removing that keyword allowed every reduction phase through all 18 action variants
to succeed; the action union and nullable `anyOf` branches need no flattening.
Local Zod strictness remains unchanged. Prompt `intent-interpreter.prompt.v2`
explicitly requires `forbiddenDirectMutation=true`; a false value is still
rejected locally. Sanitized evidence and reproducible commands are in
`packages/evals/diagnostics/README.md`.

**Alternatives considered**:

- OpenAI Responses API: optional future provider rather than the required initial provider. Its existing adapter remains isolated and available for a future explicit selection; the MVP runtime does not select it or fall back to it.
- Hard-code a premium frontier model: rejected for MVP cost/latency until eval evidence requires it.
- Leave only mocks: rejected because the product needs a real production adapter, even though real-provider smoke tests stay opt-in.
- Provider-specific domain types: rejected by the provider-independence principle.

## Decision: Version Prompts, Schemas, And Eval Cases

**Rationale**: Intent interpretation, alias handling, and destructive-action safety are core product risks. AI behavior changes must be regression-testable. Versioned prompt/schema/eval artifacts make changes reviewable and traceable.

**Alternatives considered**:

- Manual spot checks: rejected because they will miss regressions.
- Production-only monitoring: useful later but insufficient before release.

## Decision: No Queue For The First Vertical Slice

**Rationale**: Normal WhatsApp workout interaction is latency-sensitive and can be processed synchronously: verify, dedupe, interpret, validate, persist, respond. A queue would add operational complexity without a concrete MVP requirement.

**Alternatives considered**:

- Queue all inbound webhooks: rejected for MVP latency and complexity.
- Queue only slow/optional jobs later: accepted for reminders, large exports, analytics aggregation, or long-running deletion.

## Decision: Preserve Historical Integrity With Snapshots And Corrections

**Rationale**: Routine changes must not rewrite completed workout history. Completed sessions should snapshot the selected routine/session template details and record session-only changes separately. Corrections update source-of-truth workout records and write audit/correction entries so analytics and PRs recalculate deterministically.

**Alternatives considered**:

- Link completed workouts only to mutable templates: rejected because routine edits would distort history.
- Append-only workout sets with no edit model: rejected because the spec requires correction and deletion.

## Decision: Enforce One Active Workout Per User In Database And Domain

**Rationale**: The spec requires at most one active workout per user. A partial unique index plus transactional command handling prevents duplicate active sessions under concurrent messages or webhook retries.

**Alternatives considered**:

- Application-only checks: rejected because concurrent webhook processing can race.
- Allow multiple active sessions: rejected by specification.

## Decision: Use Deterministic Analytics Services Over Persisted Data

**Rationale**: Analytics, PRs, previous performance, and bounded history answers must be grounded in corrected durable records. Services should query sets, sessions, exercise identities, units, load semantics, and confirmed muscle classification directly.

**Alternatives considered**:

- AI-generated analytics summaries: rejected because AI may explain but not invent or calculate source values.
- Pre-aggregated analytics only: deferred until performance requires it.

## Decision: Treat User Text As Untrusted Prompt Data

**Rationale**: WhatsApp messages, exercise names, and aliases can contain prompt-injection-like text. Prompts must isolate user-provided strings as data, forbid instruction following from those fields, and validate outputs locally. Logs should avoid raw chat content unless explicitly needed for debugging with controls.

**Alternatives considered**:

- Trust user messages inside prompts: rejected because it can undermine structured action constraints.

## Decision: Use Confirmation Tokens For Dangerous Or Permanent Actions

**Rationale**: Destructive deletion, completed-history edits through WhatsApp, identity merges, and permanent routine changes must not rely solely on model confidence. A pending action record with a single-use confirmation token makes repeated confirmations idempotent and auditable.

**Alternatives considered**:

- Natural language "yes" without pending action state: rejected because it is ambiguous and hard to make idempotent.

## Open Technical Questions

- Choose Prisma or Drizzle after implementation preferences are known.
- Choose the auth library/provider after deployment and account requirements are known.
- Choose hosting and secret management before production.
- Measure candidate AI models against eval cases before changing the default model selection.
- Define production privacy, retention, third-party processing, and model-training commitments before release.

## External References Consulted

- [OpenAI Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), for the provider recommendation criteria around strict schema-shaped outputs.
- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing), for the initial free-tier choice and data-handling terms.
- [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), for classification/extraction and structured output support.
- [Gemini GenerateContent structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), for the REST structured JSON adapter.
- [Meta-hosted WhatsApp Cloud API webhook SDK reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/), for webhook verification and signature-boundary planning.
- [WhatsApp Business Platform policy](https://whatsappbusiness.com/policy/?faq=5), for the service-window/template constraint that belongs at the messaging boundary.
