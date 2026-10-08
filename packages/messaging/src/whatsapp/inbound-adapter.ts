import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedWhatsAppMessage } from "../../../contracts/src/index.js";
import { DomainError } from "../../../persistence/src/index.js";
import { z } from "zod";
const payloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({
    id: z.string().min(1), changes: z.array(z.object({ value: z.object({
      metadata: z.object({ phone_number_id: z.string().min(1) }),
      messages: z.array(z.object({ id: z.string().min(1), from: z.string().min(1), timestamp: z.string().optional(), text: z.object({ body: z.string().max(8192) }).optional() })).max(100).optional(),
      statuses: z.array(z.object({ id: z.string().min(1).max(512), status: z.enum(["sent", "delivered", "read", "failed"]), timestamp: z.string().regex(/^\d{1,12}$/), recipient_id: z.string().regex(/^\d{5,20}$/), biz_opaque_callback_data: z.string().max(128).optional() })).max(100).optional()
    }) })).max(100)
  })).max(100)
});

export type WhatsAppFixturePayload = {
  object: "whatsapp_business_account";
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        metadata: { phone_number_id: string };
        messages?: Array<{
          id: string;
          from: string;
          text?: { body: string };
        }>;
      };
    }>;
  }>;
};

export class WhatsAppInboundAdapter {
  constructor(private readonly appSecret: string) {}

  sign(rawBody: string): string {
    return `sha256=${createHmac("sha256", this.appSecret).update(rawBody).digest("hex")}`;
  }

  verifyWebhookPost(rawBody: string, signature: string): void {
    const expected = this.sign(rawBody);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    if (
      expectedBuffer.length !== actualBuffer.length ||
      !timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new DomainError("Invalid WhatsApp signature", "INVALID_WEBHOOK_SIGNATURE");
    }
  }

  normalize(rawBody: string, signature: string): NormalizedWhatsAppMessage[] {
    this.verifyWebhookPost(rawBody, signature);
    const payload = payloadSchema.parse(JSON.parse(rawBody));
    const messages: NormalizedWhatsAppMessage[] = [];
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        for (const message of change.value.messages ?? []) {
          if (!message.text) continue;
          messages.push({
            provider: "WHATSAPP_CLOUD_API",
            providerAccountId: change.value.metadata.phone_number_id,
            providerMessageId: message.id,
            providerUserIdentityHash: createHash("sha256").update(message.from).digest("hex"),
            text: message.text?.body ?? "",
            rawPayloadHash: createHash("sha256").update(rawBody).digest("hex"),
            ...(message.timestamp && /^\d{1,12}$/.test(message.timestamp) ? { providerSentAt: Number(message.timestamp) * 1000 } : {})
          });
        }
      }
    }
    return messages;
  }

  decodeProduction(rawBody: string, signature: string, accountId: string) {
    // Verify before parsing or trusting any provider field. Validate the entire batch before execution.
    const messages = this.normalize(rawBody, signature);
    const payload = payloadSchema.parse(JSON.parse(rawBody));
    const recipients: Array<{ messageId: string; accountId: string; identityHash: string; address: string; timestamp: Date }> = [];
    const receipts: Array<{ accountId: string; providerMessageId: string; status: "sent" | "delivered" | "read" | "failed"; timestamp: Date; recipientHash: string; logicalId?: string }> = [];
    for (const entry of payload.entry) for (const change of entry.changes) {
      if (change.value.metadata.phone_number_id !== accountId) throw new DomainError("Unexpected provider account", "INVALID_PROVIDER_ACCOUNT");
      for (const message of change.value.messages ?? []) {
        if (!message.text) continue;
        if (!/^\d{5,20}$/.test(message.from) || !/^\d{1,12}$/.test(message.timestamp ?? "")) throw new DomainError("Invalid provider message metadata", "INVALID_PROVIDER_METADATA");
        const timestamp = new Date(Number(message.timestamp) * 1000);
        if (!Number.isFinite(timestamp.getTime()) || timestamp.getTime() > Date.now() + 60_000) throw new DomainError("Invalid provider timestamp", "INVALID_PROVIDER_METADATA");
        recipients.push({ messageId: message.id, accountId, identityHash: createHash("sha256").update(message.from).digest("hex"), address: message.from, timestamp });
      }
      for (const status of change.value.statuses ?? []) {
        const timestamp = new Date(Number(status.timestamp) * 1000);
        if (!Number.isFinite(timestamp.getTime()) || timestamp.getTime() > Date.now() + 60_000) throw new DomainError("Invalid provider timestamp", "INVALID_PROVIDER_METADATA");
        receipts.push({ accountId, providerMessageId: status.id, status: status.status, timestamp, recipientHash: createHash("sha256").update(status.recipient_id).digest("hex"), ...(status.biz_opaque_callback_data ? { logicalId: status.biz_opaque_callback_data } : {}) });
      }
    }
    return { messages, recipients, receipts };
  }
}
