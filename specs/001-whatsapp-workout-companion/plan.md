# Implementation Plan: WhatsApp Workout Companion

**Branch**: `001-whatsapp-workout-companion` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-whatsapp-workout-companion/spec.md`

## Summary

Build a WhatsApp-first workout companion with a web product for account setup, routine configuration, history, analytics, edits, export, and deletion. Use an end-to-end TypeScript monorepo so web, API, WhatsApp, AI interpretation, persistence, analytics, and evaluations share one provider-independent workout domain model.

The architecture centers on deterministic domain commands. WhatsApp and web inputs are transports. AI may interpret ambiguous user language into structured proposed actions, but every durable state change goes through schema validation, domain validation, authorization, idempotency checks, and deterministic command execution before persistence.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js LTS 22.x. Strict TypeScript across apps and packages.

**Primary Dependencies**: Next.js app for web and API routes/server actions, React for web UI, PostgreSQL, Prisma or Drizzle for typed relational access, Zod for contracts and runtime validation, official Meta WhatsApp Cloud API over HTTPS behind a messaging adapter, OpenAI Responses API or equivalent provider behind an AI adapter with strict structured output support, Vitest, Playwright, and an evaluation runner based on versioned JSONL/YAML cases.

**Storage**: PostgreSQL. Relational constraints are required for user ownership, one active workout per user, historical session snapshots, idempotency records, corrections, aliases, PRs, analytics queries, exports, and deletion requests.

**Testing**: Vitest for domain, parser, analytics, and contract tests; integration tests against PostgreSQL; Playwright for web critical flows; webhook integration tests with signed fixture payloads; AI contract and eval regression tests using frozen cases and provider-mocked structured outputs by default.

**Target Platform**: Web application and API running on a Linux Node.js hosting environment, with PostgreSQL and HTTPS endpoints for WhatsApp webhooks.

**Project Type**: Monorepo web product with reusable domain packages and provider adapters. Not microservices for MVP.

**Performance Goals**: Normal in-gym message loop should avoid AI when deterministic parsing is safe. Target a fast-path response path under 1 second p95 excluding WhatsApp provider latency; AI-assisted paths should target under 4 seconds p95 where the provider is healthy. Analytics views should be interactive for pilot-sized user history without pre-aggregation.

**Constraints**: AI must never directly mutate persistence. WhatsApp provider details must not leak into domain logic. At most one active workout per user. Duplicate webhook deliveries must not create duplicate sets. Historical completed workouts must remain stable when routines change. No autonomous coaching decisions.

**Scale/Scope**: Pilot production architecture for a single web app and WhatsApp integration. No invented massive-scale assumptions. Async infrastructure is deferred unless needed for exports, reminders, or long-running operations after the first vertical slice.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate Result | Design Response |
|-----------|-------------|-----------------|
| I. Specification Before Implementation | PASS | Plan is derived from `spec.md`; no source code or tasks are created. |
| II. AI Must Have a Justified Responsibility | PASS | Deterministic parser handles safe set notation; AI is reserved for ambiguity, aliases, corrections, and bounded questions. |
| III. AI Must Not Be The Final Authority On Durable Workout State | PASS | AI returns structured proposed actions only; deterministic command handlers own mutation. |
| IV. Structured AI Boundaries | PASS | Contracts define discriminated actions with schema validation and versioning. |
| V. Never Invent Workout Data | PASS | Domain validation requires known numeric values, confirmed exercise identity, compatible units/load semantics, or clarification. |
| VI. User Control And Correctability | PASS | Corrections, destructive actions, completed-history edits, and permanent routine changes use deterministic confirmation rules. |
| VII. Unknown Exercises Must Not Block Logging | PASS | Data model includes user-specific exercise identity, alias confirmation, and classification state. |
| VIII. Deterministic Analytics | PASS | Analytics services calculate metrics from persisted structured data only. |
| IX. AI Changes Require Evaluation | PASS | Evaluation architecture is planned before implementation. |
| X. Tests Are Part Of Implementation | PASS | Test strategy spans domain, parser, state machine, analytics, persistence, webhooks, AI contracts, evals, and end-to-end flows. |
| XI. Human Review Is A Required Gate | PASS | Plan calls out unresolved decisions and validation evidence. |
| XII. Privacy And Security By Design | PASS | Auth, ownership, webhook verification, prompt injection controls, sensitive logging limits, export, and deletion are planned. |
| XIII. Provider Independence | PASS | WhatsApp and AI providers sit behind interfaces. |
| XIV. Scope Discipline | PASS | Autonomous programming, progression, deload, nutrition, social, and wearables remain out of scope. |
| XV. Evidence Over Assumption | PASS | Technical decisions and unresolved decisions are explicit. |
| XVI. Small, Reviewable Delivery | PASS | Monorepo supports vertical slices without microservices. |
| XVII. Traceability | PASS | Contracts, data model, quickstart, and future tasks trace to requirements. |
| XVIII. Failure Transparency | PASS | Testing and eval failures must be reported, not hidden. |
| XIX. Simplicity Before Complexity | PASS | Single app monorepo, no queue for first vertical slice. |
| XX. Constitution Authority | PASS | No known constitution conflict. |

## Architecture

### Execution Flow

```text
incoming message
-> messaging adapter verifies provider authenticity and extracts provider message id
-> idempotency guard records or rejects duplicate delivery
-> user/link lookup and authorization
-> context retrieval for active workout, routine sequence, aliases, recent sets, and bounded history scope
-> deterministic fast-path parser for safe inputs such as 45x10, 45 kg x 10, same x 9, and comma-separated sets
-> AI interpretation only when deterministic parsing cannot safely resolve intent
-> structured proposed action
-> schema validation
-> domain validation and confirmation-policy evaluation
-> deterministic command execution in a transaction
-> persistence
-> deterministic analytics/PR/previous-performance derivation where needed
-> response generation
-> outbound messaging adapter
```

AI output is advisory. The command layer treats it the same way it treats web/API input: untrusted until schema, authorization, idempotency, confirmation, and domain invariants pass.

### Boundary Model

- `transport`: HTTP, auth/session, WhatsApp webhook, outbound messaging.
- `intent`: deterministic parser, AI interpreter, structured action schemas, prompt/schema versions.
- `application`: orchestration, idempotency, confirmation workflow, authorization, transactions.
- `domain`: exercises, routines, workout sessions, state machine, commands, corrections, PR rules, analytics rules.
- `persistence`: PostgreSQL schema, repositories/query services, migrations.
- `presentation`: web UI and WhatsApp response formatting.
- `evals`: AI behavior datasets, regression runner, and scenario fixtures.

### Hybrid Deterministic And AI Strategy

Use deterministic parsing first for safe patterns:

- Numeric set notation: `45x10`, `45 kg x 10`, `45kg for 10`, `45 each 10`.
- Repeated set groups: `45x10, 45x9, 45x8`.
- Active-exercise context where exercise identity, preferred unit fallback, and load semantics are safe.
- `same x 9` only when a previous set exists in the current active exercise context and the copied fields are compatible.
- Direct active-workout commands with unambiguous targets: `next`, `delete last set`, `finish workout`.

Use AI interpretation for ambiguity:

- Natural exercise changes such as "bench is busy let's do shoulder press first".
- Unknown or alias-like exercise names such as "that red hammer machine instead today".
- Corrections with conversational references.
- Permanent versus session-only intent when language is not rule-clear.
- Bounded history questions and unsupported coaching-question detection.

The AI interpreter returns a discriminated proposed action. It cannot return executable code, SQL, provider operations, or direct persistence instructions.

### Structured AI Action Contract

Planned action families are documented in [contracts/ai-actions.md](./contracts/ai-actions.md). Initial discriminants:

- `START_WORKOUT`
- `RESUME_WORKOUT`
- `LOG_SET`
- `LOG_MULTIPLE_SETS`
- `CORRECT_SET`
- `DELETE_SET`
- `CHANGE_ACTIVE_EXERCISE`
- `SKIP_EXERCISE`
- `REPLACE_EXERCISE`
- `ADD_EXERCISE`
- `CREATE_CUSTOM_EXERCISE`
- `MAP_EXERCISE_ALIAS`
- `CHANGE_SESSION`
- `UPDATE_ROUTINE_REQUEST`
- `FINISH_WORKOUT`
- `QUERY_HISTORY`
- `QUERY_ANALYTICS`
- `UNKNOWN`

These names are planning-level contract names and may be refined before implementation if the final schema remains traceable to the same behavior.

### Workout State Machine

Explicit session statuses:

- `NONE`: no active workout.
- `PROPOSED`: workout identified but not started; may include pending temporary changes.
- `ACTIVE`: workout started and can accept set logging.
- `PAUSED`: resumable state if explicit pause/resume is implemented.
- `INCOMPLETE`: saved with recorded data but intentionally not completed.
- `COMPLETED`: user intentionally completed or saved as completed.
- `DISCARDED`: abandoned and excluded from completed history and sequence advancement.
- `CANCELLED_REPLACED`: active workout explicitly replaced by another session.

Exercise context is a field on the active session, not inferred from planned set counts. Set logging never advances exercise context automatically. Transitions require explicit user intent.

Enforcement:

- Partial unique database index allows at most one `PROPOSED`, `ACTIVE`, or `PAUSED` workout per user.
- `START_WORKOUT` when an active workout exists returns choices: resume, finish, save incomplete, discard, or replace.
- Completion affects routine sequence only when status is `COMPLETED`, not when skipped/rested/discarded.

### Routine Sequencing

Routine session templates have a stable sequence order plus schedule/frequency metadata. The next proposed workout is selected from the routine sequence by examining completed workout history for that routine and finding the next sequence item after the latest completed session. Missed calendar days do not skip items.

Schedule/frequency metadata is still useful for display, reminders, expected weekly cadence, and ambiguity resolution, but it does not advance the sequence by itself. If multiple routines or sessions are plausible, the product asks the user to choose.

### Data And Persistence

Use PostgreSQL with typed access through Prisma or Drizzle. PostgreSQL fits the domain because it provides transactional consistency, relational ownership, unique constraints for idempotency and active sessions, historical snapshots, and queryable structured history for analytics.

Core model is described in [data-model.md](./data-model.md). Completed sessions snapshot routine/template details and session-only modifications so permanent routine edits never rewrite history.

### Analytics And PR Services

All analytics are deterministic services over persisted structured data:

- Workout frequency.
- Completed workout count.
- Weekly primary-muscle set counts.
- Exercise progression.
- Previous-performance lookup.
- PR detection and recalculation.
- Last-trained dates by muscle/session/exercise.
- Monthly workout counts.

MVP muscle analytics count primary-muscle sets only. Secondary muscles do not contribute. Unclassified or uncertain custom exercises are excluded until classification is confirmed. Users may correct custom exercise classification.

PR rules:

- Exact confirmed exercise identity.
- Compatible units and load semantics.
- Highest recorded load.
- Highest reps at the same load.
- Historical corrections trigger deterministic recalculation.
- No estimated 1RM or advanced scoring in MVP.

### Correction And Confirmation Safety

Deterministic rules:

- Active-workout correction can target any set in the current workout when there is one clear target.
- `delete last set` can execute directly only for the unambiguous current active workout.
- Ambiguous corrections ask for clarification.
- Completed-history edits via WhatsApp require confirmation.
- Web completed-history editing still validates ownership and recalculates derived records.
- Destructive deletion of older sets, exercises, workouts, history blocks, account data, or export/delete request cancellation requires explicit confirmation.
- Permanent routine modifications through WhatsApp require explicit confirmation.
- Model confidence alone never authorizes destructive or permanent changes.

### Concurrency And Idempotency

- Persist inbound provider, provider account, provider message id, normalized message fingerprint, processing status, and linked user id.
- Unique index on provider message id prevents duplicate webhook processing.
- Command-specific idempotency keys prevent duplicate set creation when a webhook is retried after partial processing.
- Per-user active-workout mutations run in a transaction and acquire a row-level lock on the active workout or user workout-state row.
- Confirmation tokens are single-use and expire.
- Repeated confirmations return the existing result rather than applying the command twice.
- Stale active-workout versions fail with a refresh/clarification response.

### Security

- Authenticated web users via secure session auth.
- Every user-owned resource is authorized by owner id.
- WhatsApp linking uses a short-lived link code or signed token initiated from the authenticated web account; inbound WhatsApp identity is not trusted until verified and linked.
- Webhook GET verification and POST signature verification happen at the messaging boundary.
- Secrets are environment variables only and are never committed.
- Logs avoid raw chat content by default and record message ids, action ids, statuses, and safe error categories.
- Prompt injection controls: user messages, exercise names, and aliases are data, not instructions; prompts include strict role separation; AI cannot request tools or persistence.
- Rate limiting applies to web auth, webhook processing by WhatsApp identity, and expensive AI paths.
- Permanent/destructive changes write audit records with actor, target, before/after summary, confirmation id, timestamp, and source surface.

### WhatsApp Integration

Use the official WhatsApp Business Platform / Cloud API directly for MVP unless later implementation research finds a concrete blocker. Keep provider details behind:

- `MessagingInboundAdapter`
- `MessagingOutboundAdapter`
- `MessagingIdentity`
- `MessagingPolicy`

Inbound webhook handling verifies authenticity, deduplicates provider message ids, maps WhatsApp identity to user, and passes normalized messages to the application layer. Outbound sending handles Meta API payload shape, service-window/template constraints, provider errors, and retries at the messaging boundary only. WhatsApp policy logic does not enter workout domain code.

### AI Provider

Keep provider behind:

- `IntentInterpreter`
- `StructuredOutputClient`
- `PromptRegistry`
- `AiEvaluationRunner`

Recommend an AI provider/model with strict structured output support, low-latency small-model options, stable SDK support for TypeScript, cost controls, and regression-evaluation ergonomics. OpenAI Responses API with strict structured outputs is the initial recommendation because it supports JSON-schema-shaped outputs and TypeScript SDK workflows, but domain code must only depend on local action schemas.

Prompts, schemas, fixtures, and evaluation cases are version-controlled. AI output is validated with local schemas before domain validation.

### Evaluation Architecture

Create an eval dataset before implementation under `evals/intent/` with cases containing:

- Conversation context.
- User input.
- Expected structured action.
- Expected extracted fields.
- Required clarifications.
- Forbidden outcomes.
- Notes linking to requirements.

Coverage categories:

- Intent detection.
- Simple set logging.
- Multi-set logging.
- `same` resolution.
- Corrections and ambiguous corrections.
- Custom exercises and aliases.
- Session-only versus permanent changes.
- Unknown exercises.
- History questions.
- Unsupported coaching questions.
- Unit/load semantics.
- Destructive actions.
- Hallucination prevention.

AI behavior changes must run the regression suite. Known AI failures become fixtures when practical.

### Async Work

Do not introduce a queue for the first vertical slice. Webhook handling can perform synchronous interpretation, persistence, and response for normal workout interactions. Defer async infrastructure until needed for:

- Reminders.
- Large exports.
- Analytics pre-aggregation.
- Outbound template campaigns.
- Long-running deletion workflows.

Exports and deletion requests can begin as durable request records with synchronous small-account execution and later worker support.

### Observability

Minimum useful signals:

- Webhook verification failures.
- Duplicate inbound messages.
- Message-processing failures.
- AI schema/validation failures.
- Domain validation failures.
- Confirmation required/expired.
- Failed outbound messages.
- Latency by deterministic versus AI path.
- Evaluation pass/fail trends.

Avoid raw workout/chat content in routine logs. Use safe IDs, action types, and redacted summaries.

## Project Structure

### Documentation (this feature)

```text
specs/001-whatsapp-workout-companion/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── ai-actions.md
│   ├── api.md
│   ├── eval-cases.md
│   └── messaging.md
└── tasks.md              # Phase 2 output, not created by this plan
```

### Source Code (repository root)

```text
apps/
├── web/                  # Next.js web product and API/webhook routes
│   ├── app/
│   ├── components/
│   ├── server/
│   └── tests/
└── worker/               # Deferred; only created when async work is justified

packages/
├── domain/               # Provider-independent workout model, commands, state machine
├── contracts/            # Zod schemas shared by web, WhatsApp, AI, tests
├── persistence/          # PostgreSQL schema, migrations, repositories, query services
├── ai/                   # Provider abstraction, prompt registry, structured interpreter
├── messaging/            # WhatsApp provider adapter and messaging interfaces
├── analytics/            # Deterministic analytics and PR services
└── evals/                # AI eval runner and fixtures

tests/
├── e2e/
├── integration/
└── fixtures/
```

**Structure Decision**: Use a TypeScript monorepo with one deployable web/API app and shared packages. This prevents duplicated domain logic across web and WhatsApp while keeping provider adapters isolated. Do not split into microservices for MVP.

## Phase 0: Research

See [research.md](./research.md).

## Phase 1: Design And Contracts

- Data model: [data-model.md](./data-model.md)
- API contracts: [contracts/api.md](./contracts/api.md)
- AI action contracts: [contracts/ai-actions.md](./contracts/ai-actions.md)
- Messaging contracts: [contracts/messaging.md](./contracts/messaging.md)
- Evaluation contracts: [contracts/eval-cases.md](./contracts/eval-cases.md)
- Validation guide: [quickstart.md](./quickstart.md)

## Post-Design Constitution Check

*GATE: Re-check after Phase 1 design.*

| Principle | Gate Result | Evidence |
|-----------|-------------|----------|
| Specification Before Implementation | PASS | Artifacts plan only the approved feature and create no implementation tasks or source. |
| AI Justification And Boundaries | PASS | `ai-actions.md` and eval contract keep AI structured, justified, and regression-testable. |
| Durable State Safety | PASS | `data-model.md` includes command, correction, confirmation, idempotency, and audit concepts. |
| Never Invent Workout Data | PASS | Contracts require clarification/unknown actions when fields are missing or unsafe. |
| User Control | PASS | Confirmation and correction rules are represented in domain, contracts, and quickstart scenarios. |
| Unknown Exercise Support | PASS | Stable exercise identity, alias, classification, and merge confirmation are first-class data concepts. |
| Deterministic Analytics | PASS | Analytics are modeled as services and query outputs derived from persisted records. |
| Privacy And Security | PASS | Link ownership, webhook verification, authorization, logging limits, and prompt injection protections are planned. |
| Provider Independence | PASS | WhatsApp and AI are adapters; domain contracts are provider-independent. |
| Scope Discipline And Simplicity | PASS | Single app monorepo, no MVP queue, no autonomous coaching or advanced PR scoring. |

No constitution violations are known.

## Unresolved Technical Decisions

- Exact TypeScript package manager and workspace tool: pnpm is recommended, but no package manager exists in the repo yet.
- Prisma versus Drizzle: both fit; choose during implementation based on team preference for migration ergonomics and query complexity.
- Web authentication provider: must support secure sessions and account linking; exact library/provider remains open.
- Production hosting provider and secret manager remain open.
- AI provider/model and fallback policy remain open until cost, latency, and eval performance are measured.
- Detailed privacy, retention, and model-training commitments must be finalized before production release, per the spec assumptions.
- Launch country, pricing, WhatsApp economics, and acceptable AI error tolerance remain product decisions, not implementation blockers for this technical plan.

## Complexity Tracking

No constitution violations require complexity justification.
