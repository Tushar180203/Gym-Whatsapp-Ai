# Conversational reliability audit — 2026-10-09

## Evidence and acceptance

The user reports rejected sets, lost short-answer context, incorrect coaching/lifecycle routing, multi-set failures and unrelated replies in live WhatsApp usage. Exact transcripts were not supplied in this request; examples are reported failures, not authenticated transcript captures. Existing live-conversation-baseline.json contains 63 synthetic inputs evaluated with Gemini, 58.5% model semantic accuracy and two flagged unsafe mutations. It cannot establish live WhatsApp quality.

Acceptance requires >=95% common-action success in a realistic 300+ turn corpus, zero unsafe/duplicate mutations, invented factual values, confirmation bypasses or restart context losses. Safe model failures remain failures. AI bypass is diagnostic only.

## Old pipeline and root causes

Webhook signature verification -> provider normalization -> inbound deduplication -> LINK proof / verified owner resolution -> owner transaction lock -> PostgresConversation state and workout loading -> ConversationOrchestrator controls/confirmation -> grammar/factual/lifecycle handling -> pending slot consumption -> deterministic legacy handler -> optional Gemini envelope -> local schema -> reference/command preparation -> protected confirmation -> transactional domain commands -> response strings -> durable outbound intent -> provider acceptance/delivery.

1. ROUTING/AI_INTENT: action contract lacks plan/current-state/social/pending-answer actions. Understanding cannot produce an executable representation.
2. AI_ENTITY_EXTRACTION/DOMAIN_POLICY: numeric evidence checks accept only digit tokens; number words and natural unit names are rejected despite correct proposals.
3. PENDING_STATE/CONTEXT: unmatched text in replacement source/replacement slots is treated as an exercise name before AI. CUSTOM, TARGET and START frames also recover before semantic interpretation.
4. ROUTING: broad should-based coaching classification preempts factual intent. Numeric grammar itself correctly requires whole-message consumption; this must remain true.
5. CONTEXT: model receives mode and replacement parent, but not previous set, active load convention, generic pending drafts or recent referenced objects.
6. RESPONSE_PLANNER: typed response formatter wraps raw business strings; applied status is inferred from English copy.
7. ROUTING telemetry lacks explicit schema validation, resolution result and response category. Provider failure details collapse into AI_FAILED.
8. DATASET: existing green tests validate handcrafted deterministic paths and mocked proposals. The 63-case live suite largely isolates one turn; it does not prove 300-turn acceptance or complete restart continuity.

## Intended architecture

Authenticated inbound -> owner/link/deduplication -> durable typed context -> exact high-confidence syntax / explicit pending replies -> universal contextual semantic interpreter -> strict local proposal validation -> deterministic target resolution/ambiguity -> authorization/numeric/domain/confirmation/idempotency checks -> existing command transaction -> typed response planning -> durable delivery intent -> provider acceptance.

Language proposals never directly mutate data. Query/social interruptions retain parents. Semantic pending answers may fill only the expected typed slot; they cannot approve protected confirmation. Three bounded frames, ten-minute expiry and workout version guard remain authoritative. Missing values must produce typed drafts. Numeric-word normalization provides evidence only, never fuzzy correction of digit values. Existing aliases and exact durable ownership resolve identities; model confidence cannot resolve ambiguity.

## Scope and implementation tracking

This document records the current user-authorized hardening requirements. No coaching, analytics features, provider, autonomous programming, reminders or agents are added. Completion requires the acceptance evidence, not just green unit tests. See tasks.md T136 onward.
