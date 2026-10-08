# Domain Conversation Orchestration

Approved input: user request of 2026-10-08, sections A-AH. This extends conversational robustness within the existing workout domain, not product scope or provider/retention policy.

## Boundaries

Authenticity, deterministic LINK verification and verified-user ownership precede conversation routing. The PostgreSQL owner transaction calls one ConversationOrchestrator. It owns routing and short-lived typed continuations; Gemini proposes existing schema-validated actions only. Existing Us4Commands, WorkoutSelection, WorkoutLifecycle and factual query services remain the mutation/query authorities. No model-controlled memory, arbitrary action list, queue or raw transcript store.

## State And Ordering

One owner-scoped, versioned conversation record stores mode, a maximum-three-frame structured continuation stack, recent exercise/set IDs, a bounded last question and source event timestamp. Modes derive from persisted workouts: IDLE, WORKOUT_PROPOSED, WORKOUT_ACTIVE, WORKOUT_FINISH_PENDING. Pending frames expire after ten minutes and capture workout ID/version. Cancellation invalidates continuations and pending protected actions. An older timestamp cannot replace newer context. Provider timestamps with equal-second precision cannot establish total order; existing per-user locks serialize ties.

Routing: link/system boundary; explicit protected confirmation; cancellation/help/repeat; pending answer resolution; safe deterministic compound log+next; deterministic grammar/logging/correction/lifecycle/plan/history; greetings; local-schema-validated AI fallback; contextual recovery. Explicit interruptions answer factual questions or greetings while retaining the parent until expiry; durable session mutations invalidate stale targets. LOG_SET(S) then NEXT is the generic compound mutation allowlist, validated under a savepoint before effects commit. Deferring an exercise is a separately defined, prevalidated session operation (reorder then navigate), not permission to execute arbitrary action lists.

## Resolution And Safety

Current-session names, confirmed aliases, ordinals, active/recent/previous/next context resolve deterministically. Exact matches outrank bounded typo matching. Several candidates always clarify; fuzzy resolution never merges identities or searches unrelated users. Unknown replacement uses the existing custom-identity confirmation, then resumes the structured parent and separately confirms a permanent change. Numeric corrections require explicit values. Reps-only logging may inherit only an existing current-exercise set; otherwise it asks for load. WorkoutSet remains current truth with existing Correction audit.

Plan facts are distinct from coaching. Queries cannot calculate through AI or change workout context. Responses are typed then formatted; legacy command copy is bridged as a domain-result response rather than reinterpreted as a command. Safe telemetry records route/mode/action/outcome, not chat, reasoning or addressing.

## Validation

Grammar/reference unit invariants, semantic conversation fixtures covering all twenty requested scenario families, real PostgreSQL restart/replay/stale/ownership/confirmation/nested-continuation tests, and the full existing suite. Model quality remains separate from mock boundary evaluation. New migration follows 0009, defaults legacy users safely, and preserves active sessions. Export/deletion must account for short-lived state without introducing retention promises.

## Implementation And Review Map

| Concern | Implementation / evidence |
|---|---|
| Central owner-authorized pipeline | `packages/persistence/src/postgres.ts` invokes `ConversationOrchestrator` once inside the existing inbound owner transaction; LINK/authenticity remain ahead of it |
| Typed state and continuations | `packages/domain/src/conversation/state.ts`; `0010_conversation.sql`; owner/version checks, three frames maximum, ten-minute validity |
| Priority and interruption | `orchestrator.ts`: protected yes/no before AI; short answers resolve their typed slot; query/help/social interruptions preserve valid parents; cancel/back reject or unwind |
| Nested custom exercise / query | Existing custom confirmation creates identity, then resumes replacement; a query clarification can temporarily sit above the change; PostgreSQL restart tests cover both |
| References and aliases | `references.ts`: exact current-session name/alias/ID, ordinal, active/recent/previous/next; bounded unique typo match; exact owner lookup beyond the 100-identity prompt bound |
| Correction / self-repair | Existing audited commands; explicit reps/value extraction, field clarification for ambiguous numeric repair, no invented load; recorded-set exercise reassignment asks rather than moving history implicitly |
| Facts versus coaching | Existing deterministic history/analytics services plus contextual plan/current exercise/last-set facts; literal "should" in a plan request is not a coaching refusal |
| Active lifting | Normalized units/notation, multi-set logging, same/reps follow-up using exact existing context; logging never implicitly changes active exercise |
| AI boundary | Prompt v5 carries bounded names/aliases, mode, typed parent and allowed action types; unchanged action.v1 Zod validation, owner target resolution, numeric evidence, clarification and confirmation gates |
| Responses | `responses.ts` formats typed plan/fact/log/clarification/help/recovery responses; existing command copy remains a compatibility domain-result bridge |
| Safe observability | `observability/events.ts`: winning route, mode, pending/action, AI invocation, clarification/confirmation/outcome; no transcript, model reasoning or addressing |
| Durable lifecycle | State commits with command/result, exact duplicate reuses the result; old provider timestamp cannot overwrite state; data deletion removes short-lived state |
| Executable simulations | `tests/fixtures/conversations/scenarios.ts` and `tests/postgres/conversation.test.ts`: twenty semantic families, long messy workout, restart/replay/ownership/AI-failure/migration cases |
| Provider-independent evals | `conversation-variation.yaml` adds seven eval-case.v1 cases; normal tests use mock structured output, never live credentials |

All new implementation files: `packages/domain/src/conversation/{state,grammar,references,responses,orchestrator}.ts`, its two test files, `packages/persistence/src/conversation.ts`, `packages/persistence/migrations/0010_conversation.sql`, `packages/domain/src/observability/events.test.ts`, `tests/fixtures/conversations/scenarios.ts`, `tests/postgres/conversation.test.ts`, and `packages/evals/fixtures/intent/conversation-variation.yaml`.

Integration edits: `package.json`, persistence `postgres.ts` and `data-controls.ts`, contracts `api/types.ts`, AI `interfaces.ts` and `prompt-registry.ts`, messaging `whatsapp/inbound-adapter.ts`, domain `messaging/history-query-parser.ts` and `observability/events.ts`. Existing integration/PG assertions were updated to prove safe recovery, unchanged durable state and human-readable replies instead of expecting provider failures to produce generic request errors. Planning/contracts/traceability/quickstart and validation evidence are reconciled separately; unrelated existing worktree changes are preserved.

## Remaining Limitations

- Arbitrary multi-intent lists are not executed. Only approved fixed operations are allowed; unsupported combinations ask for separate messages.
- Recorded-set exercise reassignment requires clarification under existing correction policy. It is not silently inferred from "sorry, incline".
- Numeric words and missing durable numeric data are not guessed. Ambiguous targets/fields and fuzzy ties clarify.
- Equal-second provider timestamps do not prove order; per-user serialization supplies a safe tie order, not reconstruction of the user's original send order.
- The state is bounded operational memory, not a retention-policy commitment. Expiry invalidates use; physical erasure/backup policy remains Phase C.
- Mock evals prove schema/policy behavior, not live Gemini paraphrase accuracy. No live Gemini or WhatsApp calls are part of this pass.
- Existing command result copy is bridged, not comprehensively rewritten. No public-release approval or new notification/provider policy is implied.
