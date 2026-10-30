import type { MessageTemplate } from "../../contracts/src/messaging/template.js";
export type SendInput = { recipientIdentityId: string; body: string; idempotencyKey: string; template?: MessageTemplate };
export type SendResult = { providerMessageId: string };
export interface MessagingTransport { sendMessage(input: SendInput): Promise<SendResult> }
export type FailureCategory = "RETRYABLE" | "PERMANENT" | "CONFIGURATION" | "INVALID_RECIPIENT" | "UNKNOWN";
export class TransportError extends Error {
  constructor(readonly category: FailureCategory, readonly code: string, readonly safeToRetry = false, readonly httpStatus?: number) {
    super(`Messaging transport failed: ${code}`);
  }
}
export interface RecipientResolver {
  resolve(identityId: string): Promise<{ address: string; lastInboundAt: Date }>;
}
export class FakeMessagingTransport implements MessagingTransport {
  readonly calls: SendInput[] = [];
  failure: TransportError | undefined;
  async sendMessage(input: SendInput): Promise<SendResult> {
    this.calls.push(input);
    if (this.failure) throw this.failure;
    return { providerMessageId: `fake-${input.idempotencyKey}` };
  }
}
