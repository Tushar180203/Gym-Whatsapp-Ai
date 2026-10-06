<!--
Sync Impact Report
Version change: template scaffold -> 1.0.0
Modified principles:
- Placeholder principles replaced with initial project constitution principles I-XX
Added sections:
- Product Boundaries
- Delivery And Review Workflow
Removed sections:
- Placeholder template comments and unresolved placeholder tokens
Follow-up TODOs:
- None
-->

# WhatsApp Workout Companion Constitution

## Core Principles

### I. Specification Before Implementation

No product feature may be implemented before its expected behavior is defined in the
relevant specification. Implementation MUST trace back to an approved requirement,
task, bug, or documented decision. Agents MUST NOT silently change specifications to
make an implementation appear correct. If implementation and specification conflict,
the conflict MUST be surfaced explicitly before the work is treated as complete.

Rationale: The product depends on trustworthy workout records and bounded AI behavior;
untracked implementation drift can corrupt both.

### II. AI Must Have a Justified Responsibility

AI may be used where interpretation or ambiguity genuinely benefits from reasoning,
including natural workout language, intent detection, aliases, unknown or custom
exercises, conversational references, corrections, and bounded history questions.
AI MUST NOT be used merely because AI is available. Deterministic logic MUST be
preferred for behavior that can be reliably expressed as explicit rules.

Rationale: The approved product direction values intelligence at ambiguity boundaries,
not gratuitous model calls in place of clear domain logic.

### III. AI Must Not Be The Final Authority On Durable Workout State

AI may interpret user intent and propose structured actions. Durable changes to
workout sessions, exercises, sets, reps, weights, units, edits, deletions, permanent
workout-plan changes, and analytics MUST pass through deterministic validation before
persistence. AI output MUST NOT directly mutate persistent application state.

Rationale: Training history is the product's core asset; model output is advisory
until validated by deterministic application rules.

### IV. Structured AI Boundaries

AI interactions that affect application behavior MUST produce explicit structured
outputs wherever practical. Structured outputs MUST be validated before use. Invalid,
incomplete, or unsupported actions MUST fail safely instead of being guessed.

Rationale: Structured, validated boundaries make AI-assisted behavior auditable,
testable, and correctable.

### V. Never Invent Workout Data

The system MUST NOT fabricate missing weights, reps, units, exercise identity, set
numbers, workout history, or personal records. When required information is ambiguous,
the system MUST either resolve it safely from confirmed context or ask the user for
clarification. Accuracy of training history takes priority over conversational
smoothness.

Rationale: A pleasant reply that records false training data damages user trust and
future training decisions.

### VI. User Control And Correctability

Users MUST be able to understand what was recorded and correct mistakes. Ambiguous
destructive actions, including deletion or permanent plan modification, MUST require
sufficient certainty or confirmation. Temporary session changes MUST NOT silently
become permanent plan changes.

Rationale: The companion may reduce logging friction only if users remain in control
of their records and plans.

### VII. Unknown Exercises Must Not Block Logging

The system MUST support user-defined and previously unknown exercises or machines. A
global exercise database MUST NOT be treated as exhaustive. Unknown exercises may be
interpreted or classified with AI assistance, but user-specific exercise identity and
history MUST remain stable after confirmation.

Rationale: Real gyms contain custom machines, local names, and user shorthand that
rigid exercise libraries cannot fully anticipate.

### VIII. Deterministic Analytics

Metrics such as training frequency, set counts, workout completion, personal records,
exercise progression, and muscle-frequency analytics MUST be calculated from
persisted structured data through deterministic logic. AI may explain or summarize
those metrics, but it MUST NOT invent the underlying values.

Rationale: Analytics are evidence derived from recorded history, not language-model
claims.

### IX. AI Changes Require Evaluation

Changes to prompts, intent classification, structured AI schemas, exercise
interpretation, history-question behavior, or ambiguity handling MUST include or
update relevant evaluation cases. Known AI failures SHOULD become regression
evaluations whenever practical, with any exception documented.

Rationale: AI behavior changes can silently alter product outcomes unless they are
captured in repeatable evaluations.

### X. Tests Are Part Of Implementation

Important domain behavior MUST have automated tests. Changes are not complete merely
because generated code compiles. Relevant linting, type checking, tests, and AI
evaluations MUST pass before work is considered ready for review, unless a failure is
explicitly documented as an unresolved blocker.

Rationale: Correctness for workout logging, validation, privacy, and AI boundaries
requires executable evidence.

### XI. Human Review Is A Required Gate

AI-generated implementation MUST NOT be treated as correct solely because an agent
reports completion. Important changes require human review before merge or release.
Agents MUST surface assumptions, uncertainty, trade-offs, failed tests, and
specification conflicts rather than hiding them.

Rationale: Human review is the accountability layer for scope, product judgment, and
unresolved risk.

### XII. Privacy And Security By Design

Secrets, tokens, credentials, private WhatsApp data, and sensitive user information
MUST NOT be exposed in logs, prompts, analytics, or source control unnecessarily.
External input MUST be treated as untrusted. Data collection MUST be limited to what
the product actually needs. Privacy, retention, export, and deletion behavior MUST be
explicitly defined before production release.

Rationale: Workout data and chat-derived data require trust, restraint, and clear
handling before users can rely on the product.

### XIII. Provider Independence

External services such as messaging providers and AI model providers MUST be isolated
behind clear product and application boundaries where practical. Product behavior
MUST NOT depend unnecessarily on provider-specific details. Provider-specific
constraints MUST NOT leak throughout unrelated domain logic.

Rationale: WhatsApp and AI provider constraints are important, but provider details
cannot distort the workout domain model or make the product brittle.

### XIV. Scope Discipline

The approved product direction is an intelligent workout companion, not an autonomous
trainer. The product MUST NOT silently expand into automatic workout programming,
automatic progression decisions, adaptive training, medical or rehabilitation
guidance, nutrition coaching, social networking, wearable integrations, or a trainer
marketplace unless a future approved specification intentionally changes scope.

Rationale: The completed assessment chose a bounded companion because the evidence
supports logging friction and structured history, not autonomous coaching.

### XV. Evidence Over Assumption

Artifacts and discussions MUST clearly distinguish verified facts, product
hypotheses, implementation decisions, and unresolved questions. Assumptions MUST NOT
be turned into requirements without an explicit decision. When real-user evidence
contradicts an existing assumption, the relevant specification or decision artifact
MUST be updated instead of working around the contradiction in code.

Rationale: The assessment identifies material unknowns; preserving that uncertainty
prevents premature product commitments.

### XVI. Small, Reviewable Delivery

Implementation work SHOULD be organized as small vertical slices that can be
independently implemented, tested, evaluated, and reviewed. Broad, uncontrolled
changes that attempt to implement the entire product at once MUST be rejected or
split before review.

Rationale: Small slices make AI behavior, domain correctness, and scope discipline
easier to inspect.

### XVII. Traceability

Important implementation work MUST be traceable through product requirement,
implementation task, code change, automated test or evaluation, and review evidence.
This relationship MUST be maintained as the product evolves.

Rationale: Traceability keeps specifications, implementation, validation, and review
aligned over time.

### XVIII. Failure Transparency

Agents MUST NOT disable failing tests to make work appear complete, silently ignore
evaluation failures, suppress relevant errors, modify requirements to match incorrect
implementation, or claim successful validation that was not actually executed.
Failures and uncertainty MUST be surfaced clearly.

Rationale: Hidden failure is more dangerous than visible incompleteness in a product
whose value depends on trustworthy records.

### XIX. Simplicity Before Complexity

The project MUST prefer the simplest design that satisfies the approved
specification. Unnecessary abstractions, services, agents, model calls, or
infrastructure MUST NOT be introduced without a concrete need. Additional AI agents
MUST have clearly separate responsibilities.

Rationale: Complexity increases review burden and failure modes, especially around
AI, persistence, and provider integrations.

### XX. Constitution Authority

This constitution governs subsequent specification, planning, task generation,
implementation, review, and convergence. If a later artifact conflicts with these
principles, the conflict MUST be resolved explicitly rather than silently bypassing
the constitution.

Rationale: Governance only works if later project artifacts are subordinate to it.

## Product Boundaries

The product is a WhatsApp-first intelligent workout companion for self-directed
intermediate-to-experienced lifters who already have routines and need lower-friction
logging plus trustworthy structured history. WhatsApp is the intended surface for
lightweight capture, corrections, and bounded history questions; web is the intended
surface for setup, detailed review, editing, history, and analytics.

The product MUST remain focused on accurate workout capture, deterministic durable
state, user-correctable history, unknown exercise support, previous-performance
context, PR detection, and deterministic analytics. The product MUST NOT treat AI
parsing alone as sufficient differentiation.

The following areas are outside approved scope unless a future specification and
decision artifact explicitly change direction: autonomous workout programming,
automatic progression decisions, adaptive exercise selection, volume or deload
decisions, medical or rehabilitation guidance, form coaching, nutrition, social
features, wearable integrations, trainer marketplace behavior, and an exhaustive
global exercise database.

Open product questions from assessment artifacts, including launch market, pricing,
acceptable AI error tolerance, WhatsApp economics, detailed workout notation, and
privacy commitments, MUST remain visible as open questions until resolved by
evidence or documented decision.

## Delivery And Review Workflow

Every meaningful change MUST begin from an approved specification, task, bug, or
documented decision and MUST preserve traceability through implementation, automated
tests or evaluations, and review evidence. Agents working on the project MUST surface
assumptions, conflicts, skipped checks, failed validations, and uncertainty in their
handoff notes.

Specifications MUST define expected behavior before implementation begins. Plans and
tasks MUST identify relevant deterministic validation paths, AI boundaries, privacy
and security considerations, evaluation updates, and review gates. Implementations
that affect AI behavior MUST include appropriate evaluation coverage, and known AI
failures SHOULD be converted into regression evaluations whenever practical.

Before review, relevant formatting, linting, type checking, automated tests, and AI
evaluations MUST be run. If any required validation cannot be run or does not pass,
the work MUST clearly state what failed, what was not executed, and what risk remains.
Human review is required before important changes are merged or released.

## Governance

This constitution supersedes conflicting local practice, generated plans, task
lists, implementation choices, and agent claims. Specifications, plans, tasks,
reviews, and convergence checks MUST verify compliance with these principles.

Amendments require an explicit documented change to this file, including a Sync
Impact Report that identifies the version change, modified principles, added or
removed sections, and unresolved follow-up items. Amendments MUST NOT be used to
retroactively justify an implementation that conflicts with the previously approved
constitution; the conflict MUST be acknowledged and reviewed.

Versioning follows semantic governance:

- MAJOR: Backward-incompatible governance changes, principle removals, or principle
  redefinitions.
- MINOR: New principles or sections, materially expanded guidance, or new governance
  requirements.
- PATCH: Clarifications, wording fixes, and non-semantic refinements.

Compliance review is required during specification, planning, task generation,
implementation review, and convergence. Any conflict between a later artifact and
this constitution MUST be resolved explicitly before the later artifact governs
implementation.

**Version**: 1.0.0 | **Ratified**: 2026-10-06 | **Last Amended**: 2026-10-06
