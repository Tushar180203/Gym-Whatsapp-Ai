# Contract: Messaging And WhatsApp Boundary

## Interfaces

```ts
type InboundMessage = {
  provider: "WHATSAPP_CLOUD_API";
  providerMessageId: string;
  providerAccountId: string;
  receivedAt: string;
  text?: string;
  rawPayloadHash: string;
};

type OutboundMessage = {
  userId: string;
  providerAccountId: string;
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
2. Normalize payload to provider-independent inbound messages.
3. Persist `InboundMessage` with unique provider message id.
4. Ignore or return prior result for duplicates.
5. Resolve active WhatsApp identity link.
6. Reject or safely ignore unlinked workout-affecting messages.
7. Pass normalized text and user context into application message processor.

## Outbound Flow

1. Application produces provider-independent response intent.
2. Messaging boundary checks service-window/template constraints.
3. Adapter sends provider-specific payload.
4. Store outbound result, provider id, and failure category.

## Deduplication

- Provider message id is the primary dedupe key.
- Command idempotency key is derived from inbound message id plus parsed action index for multi-set messages.
- Duplicate webhook deliveries must not create duplicate sets.
- Repeated confirmations return the previous applied result.

## Boundary Rules

- WhatsApp payload shapes, policy errors, service-window checks, and template names stay in `packages/messaging`.
- Workout domain receives no Meta-specific request object.
- Raw chat content is not logged by default.
