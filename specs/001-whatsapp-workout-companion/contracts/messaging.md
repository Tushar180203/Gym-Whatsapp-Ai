# Contract: Messaging And WhatsApp Boundary

## Central Conversation Routing (2026-10-08)

Authenticated transport and deterministic LINK proof still precede verified-user resolution. All other production messages enter one `ConversationOrchestrator` within the existing owner-locked PostgreSQL inbound/command/outbound transaction.

1. Reject older source events and expire/revalidate typed continuations.
2. Resolve explicit protected confirmation; cancellation/back rejects the appropriate pending protected request.
3. Recognize control, social, plan/factual and lifecycle interruptions without letting free text masquerade as a short answer.
4. Resolve the expected pending slot from a short reply, preserving its parent operation.
5. Route deterministic lifting/correction/navigation/session grammar and the existing deterministic lifecycle/query handlers.
6. Invoke the provider-independent interpreter only for unhandled semantic variation, then locally validate the unchanged ProposedActionEnvelope, resolve targets and apply deterministic authorization/domain/clarification/confirmation policies.
7. Format a typed response and persist the winning route's logical outbound result using existing transport idempotency.

Replacement can pause for a replacement name, scope or existing custom-identity confirmation; accepted child confirmation resumes its parent automatically. Query subject clarification can interrupt a pending change without losing it. User-supplied numeric values must be proven before entering a continuation, not only at eventual command execution.

Only log-then-NEXT is a generic compound allowlist. Both steps are validated atomically under a savepoint. Deferring an exercise is a separate fixed, prevalidated session reorder/navigation operation, not an arbitrary model action list. AI cannot confirm, authorize, create memory or calculate authoritative workout facts.

AI/provider/schema failure yields a durable contextual recovery reply without a workout command. Duplicate delivery reuses that reply and does not repeatedly call AI; a new user turn can retry interpretation. Transport failures still follow the existing durable delivery retry/reconciliation rules.

Safe telemetry: mode, winning route, pending type, resolved intent, AI invocation/action type, clarification reason, confirmation flag and execution outcome; no chat, raw recipient, secret or reasoning payload. `providerSentAt` is optional for fixtures/legacy normalized messages and populated from authenticated production message timestamps.

## Interfaces

```ts
type InboundMessage = {
  provider: "WHATSAPP_CLOUD_API";
  providerMessageId: string;
  providerAccountId: string;
  providerUserIdentityHash: string;
  receivedAt: string;
  text?: string;
  rawPayloadHash: string;
};

type OutboundMessage = {
  userId: string;
  providerAccountId: string;
  providerUserIdentityHash: string;
  kind: "FREE_FORM" | "TEMPLATE";
  body: string;
  templateName?: string;
  correlationId: string;
};

interface MessagingInboundAdapter {
  verifyWebhookGet(input: unknown): WebhookVerificationResult;
  verifyWebhookPost(rawBody: Buffer, headers: Record<string, string>): VerificationResult;
  normalize(rawBody: unknown): InboundMessage[];
}

interface MessagingTransport {
  sendMessage(input: {
    recipientIdentityId: string;
    body: string;
    idempotencyKey: string; // logical outbound identity, not provider-side deduplication permission
  }): Promise<{ providerMessageId: string }>;
}
```

## Inbound Flow

1. Verify provider webhook authenticity.
2. Normalize payload to provider-independent inbound messages, including the product-controlled provider account and provider-scoped end-user identity hash.
3. Persist `InboundMessage` with unique provider message id scoped to the provider account.
4. Resume, return prior result, or safely no-op duplicates according to processing state.
5. Resolve active WhatsApp identity link from provider account plus provider user identity.
6. Reject or safely ignore unlinked workout-affecting messages.
7. Pass normalized text and user context into application message processor.

### Number-Bound Deterministic Linking

After authenticity/normalization and duplicate handling, anchored case-insensitive `LINK <32 hex characters>` is handled before linked-user lookup or AI. Malformed LINK also bypasses AI. The challenge owner must be live; the challenge must be active, unused, unexpired and match the provider sender hash. Lock owner, challenge, and provider identity; reject another owner's verified identity rather than transferring it. Consume, establish VERIFIED, encrypt the authenticated sender address via the provider-boundary transaction writer and create response intents atomically. Failed proof returns a safe webhook result without storing an unverified recipient or attempting a workout command; wrong-number rejection preserves the valid challenge. Unverified identities cannot receive normal outbound workout messages. Verification attempts use the existing bounded limiter (20/minute per provider-scoped sender), alongside general inbound limits; creation has durable owner limits.

Number changes require authenticated explicit change intent and new proof; existing identity remains live while pending. Confirmed disconnect invalidates pending challenges. Completed inbound records carry verifiedLinkId; replay and outbound delivery revalidate that link and live owner. No challenge, raw number or decrypted address enters AI prompts/logs/exports.

WELCOME is the immediate logical LINK acknowledgement, once per verified link. A usable existing plan produces a unique WORKOUT_PLAN_READY intent; later routine saves use the same per-link/routine-version builder. Persisted intents are delivered using existing request/manual transport, bounded retries and service-window policy. Outside the window, no marketing/template workaround or unconditional retry is added. There is no background worker and no autonomous notifications beyond these approved workout setup acknowledgements.

## Outbound Flow

1. Application produces provider-independent response intent.
2. Persist one logical response, resolve linked identity, and durably reserve a bounded attempt.
3. Messaging boundary resolves protected addressing and checks conversational window/text constraints; adapter sends plain text. Templates are not implemented MVP message forms.
4. Store actual provider acceptance ID or safe failure category. Unknown acceptance cannot automatically retry. Signed receipts update delivery metadata only.

## Deduplication

- `(providerAccountId, providerMessageId)` is the primary inbound dedupe key.
- `(provider, providerAccountId, providerUserIdentityHash)` identifies the provider-scoped end-user messaging identity for linking to a product `userId`; `providerAccountId` alone identifies the business/provider account and may serve many product users.
- Command idempotency key is derived from inbound message id plus parsed action index for multi-set messages.
- Duplicate webhook deliveries must not create duplicate sets.
- Completed prior processing returns the stored command/outbound result.
- In-flight processing returns a safe in-progress/no-op response or lets the provider retry.
- Retryable failures resume from durable inbound and command idempotency records.
- Already-applied commands do not apply again, even if outbound sending previously failed.
- Already-sent outbound responses are not resent unless the messaging adapter marks a retry as safe and necessary.
- Repeated confirmations return the previous applied result.

## Boundary Rules

- WhatsApp payload shapes, policy errors, service-window checks, and template names stay in `packages/messaging`.
- Workout domain receives no Meta-specific request object.
- Raw chat content is not logged by default.

## Phase B Runtime Contract

GET returns the plain numeric challenge for the correct configured token: wrong token 403, malformed/missing/duplicate fields 400, unavailable config 503. POST HMAC verification precedes payload interpretation, recipients, commands and AI. Enabled transport also validates the configured account and provider timestamps.

PENDING -> SENDING -> SENT requires provider acceptance evidence. Safe rejection uses FAILED_RETRYABLE; permanent/configuration/unknown uses FAILED_FINAL. Maximum three attempts, request-driven/manual only. Minimal sent/delivered/failed receipts are account/recipient/correlation scoped; read becomes delivered. Historic false SENT and old pending are quarantined, not replayed.

See [phase-b-transport.md](../phase-b-transport.md) for recipient protection, timeout ambiguity, configuration, reconciliation and opt-in live acceptance. No raw address enters workout/domain services.
