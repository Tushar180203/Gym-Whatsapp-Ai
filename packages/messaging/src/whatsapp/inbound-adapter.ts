import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedWhatsAppMessage } from "../../../contracts/src/index.js";
import { DomainError } from "../../../persistence/src/index.js";
import { z } from "zod";
const payloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(z.object({
    id: z.string().min(1), changes: z.array(z.object({ value: z.object({
      metadata: z.object({ phone_number_id: z.string().min(1) }),
      messages: z.array(z.object({ id: z.string().min(1), from: z.string().min(1), text: z.object({ body: z.string().max(8192) }).optional() })).max(100).optional()
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
            rawPayloadHash: createHash("sha256").update(rawBody).digest("hex")
          });
        }
      }
    }
    return messages;
  }
}
