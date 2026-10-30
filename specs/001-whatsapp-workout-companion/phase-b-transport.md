# Phase B: WhatsApp Transport

Ownership extension (2026-10-08): migration 0009 and [whatsapp-ownership-verification.md](whatsapp-ownership-verification.md) add number-bound challenges and VERIFIED gates without replacing this transport. `WHATSAPP_BUSINESS_NUMBER` is a public E.164 verification destination, distinct from phone-number ID. Existing proven links/ciphertext survive, outstanding unbound tokens are superseded. Welcome is the idempotent LINK reply; plan-ready intents wait for provider-accepted welcome, reuse existing delivery/retry/service-window restrictions and never bypass them. Normal tests are offline; no Phase C decision or live acceptance is implied.

## Provider And Addressing Decision

Use Meta WhatsApp Cloud API through provider-independent `MessagingTransport.sendMessage({ recipientIdentityId, body, idempotencyKey })`. Workout/AI commands remain unchanged. The adapter resolves the address internally and sends plain text to `/{version}/{phone-number-id}/messages`. No templates, marketing, reminders or media workflow. Meta's [official messages collection](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ba8d099d-007e-4b52-b9f2-3cf3c60e4fbc) documents the endpoint and provider acceptance IDs; [inbound fields](https://www.postman.com/meta/whatsapp-business-platform/folder/1dtuocp/messages-object) identify the sender and provider timestamp. The adapter enforces a conservative 24-hour conversation window and 4096-character text bound. Confirm configured Graph version, permissions and callback correlation in opt-in live acceptance; direct Meta documentation was rate-limited during this review.

The identity hash is NEVER a destination. Signed sender addressing is captured only inside the messaging boundary after real linking succeeds. `whatsapp_recipient_addresses` contains identity ID, AES-256-GCM ciphertext and latest verified provider message timestamp. Random IVs and identity-bound authenticated encryption prevent substitution. A dedicated 32-byte key comes from secret configuration; not from the access token/app secret. Raw addresses/ciphertext do not enter workout services, AI, ordinary logs or portable exports. Revoked links/deleted accounts cannot resolve recipients. This technically necessary storage exception creates NO retention, erasure or legal commitment. Key custody/rotation and Phase C privacy remain production decisions.

## Authenticated Webhooks

GET `/api/webhooks/whatsapp`: exactly one `hub.mode=subscribe`, `hub.verify_token`, numeric `hub.challenge`. Constant-time token comparison; plain unquoted challenge only on success. Malformed/missing/duplicate fields 400; incorrect token/mode 403; missing configuration 503. Never echo the token.

POST: bounded raw body HMAC-SHA256 `x-hub-signature-256` authentication before parsing, service creation, recipients, commands or AI. Enabled transport validates the entire batch's configured account, sender and provider timestamps before mutation. Normalize identities using the existing provider-scoped hash. Linking still consumes a single-use token. Sender revalidation, deleted-user blocking and owner command locks remain. Invalid signatures/status callbacks cannot mutate anything. Received message batch order is preserved; timestamp reordering is not promised. Replay does not extend the conversation window with server receipt time.

## Durable Delivery And Retry

One outbound row per inbound message is one logical response. `PENDING -> SENDING -> SENT`: SENT requires a valid provider acceptance ID, not merely local persistence and not necessarily handset delivery. Signed receipts update separate minimal sent/delivered/failed metadata; read is collapsed into delivered, not engagement tracking. Match account, recipient hash and provider ID, or an attempted logical ID echoed in `biz_opaque_callback_data`. Receipt handling never executes workout commands. Duplicate/out-of-order statuses cannot downgrade delivered evidence.

Durably reserve before HTTP; persist provider result afterward. Per-owner PostgreSQL session advisory locking excludes concurrent sends and deletion during the bounded network call; no transaction is held during HTTP. Existing domain transactions use the same owner lock namespace. Holding a connection for a bounded send is an MVP tradeoff. Batch latency and deployment deadlines still need sizing.

HTTP 429 is explicit rejection: FAILED_RETRYABLE with 30/60-second request-driven/manual retry and at most three total attempts. Recipient unavailable before dispatch is safely retryable/bounded. HTTP 400 is permanent; 401/403 configuration; window/text limits permanent. Timeout, connection failure, 5xx, malformed successful response or interrupted SENDING are DELIVERY_UNKNOWN / FAILED_FINAL: NO automatic replay. A signed receipt may reconcile later. Correlation data is NOT a provider idempotency guarantee. This favors preventing duplicates over guaranteed eventual delivery when acceptance is unknowable. No queue, worker or infinite retry.

Webhook 200 may acknowledge a durably completed command with failed delivery; the failure remains persisted, observable and reportable. Duplicate webhook/operator retry can resume safe attempts only, never reapply the command. Revisiting SENDING older than 60 seconds classifies it unknown. Do not override uncertainty by manually clearing flags.

## Legacy Reconciliation

Migration 0008 follows 0007 transactionally through the ledger. Old schema has no provider acceptance ID, so historic SENT has no trustworthy delivery evidence: FAILED_FINAL / LEGACY_UNKNOWN, false sent_at cleared, retry disabled. Historic PENDING/FAILED is LEGACY_NEVER_ATTEMPTED and quarantined because age/window/address evidence is absent. No workout history is deleted. Operator review can inspect external evidence; an old SENT flag never justifies replay. Current provider-ID records are accepted; current unknown attempts may reconcile via signed receipts. No automatic historic resend mechanism.

## Configuration And Operator Commands

Node 22. `WHATSAPP_PROVIDER=cloud_api` enables delivery; `disabled` keeps offline/local responses PENDING, never falsely SENT. Enabled configuration requires access token, phone-number ID, verify token, app secret, dedicated 64-hex recipient encryption key and explicit supported Graph version. See placeholders in .env.example. Existing database/Gemini configuration and production HTTPS APP_ORIGIN remain required. Startup errors print variable names, never values. Production fixes the Meta HTTPS origin; loopback origin injection is constructor-only for controlled tests, never an environment override.

Apply migrations before enabling. Inject server-only secrets through the selected secret mechanism; .env remains ignored. Report omits bodies, destinations and secrets, limited to 100 rows. Retry obeys owner/link/data-generation guards, timing, attempt cap and reconciliation state:

```bash
npm run whatsapp:delivery -- report
npm run whatsapp:delivery -- retry outbound_INTERNAL_ID
TEST_DATABASE_URL=postgresql://LOCAL_TEST_DATABASE npm run test:whatsapp:transport
```

Structured signals contain only allowlisted internal IDs, status and error code. Configuration failures require operator repair; no template/paid fallback.

## Opt-In Live Acceptance

Normal CI has no live credentials/messages. Manually provision/subscribe a test business webhook, enable credentials, link an operator-owned test account through the real flow, and send one synthetic conversational `start` message in WhatsApp. Observe one reply on the handset. Obtain the inbound provider message ID privately, then:

```bash
RUN_LIVE_WHATSAPP=1 WHATSAPP_LIVE_INBOUND_MESSAGE_ID=OPERATOR_TEST_ID npm run test:whatsapp:live
```

This narrow smoke checks the GET challenge and persisted processed inbound plus one provider-accepted outbound for that account/message ID. It sends NO additional live replies and does not synthesize inbound messages or provision Meta. Awaiting delivery receipt is reported honestly; handset observation remains manual evidence. HTTPS subscription, credentials/account permissions, external processing approval and hosting/edge review remain release gates. Phase C is not implemented.
