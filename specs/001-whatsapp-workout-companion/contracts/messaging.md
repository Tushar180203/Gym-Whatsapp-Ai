# Contract: Messaging And WhatsApp Boundary

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

interface MessagingOutboundAdapter {
  send(message: OutboundMessage): Promise<OutboundSendResult>;
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

## Outbound Flow

1. Application produces provider-independent response intent.
2. Messaging boundary checks service-window/template constraints.
3. Adapter sends provider-specific payload.
4. Store outbound result, provider id, and failure category.

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
