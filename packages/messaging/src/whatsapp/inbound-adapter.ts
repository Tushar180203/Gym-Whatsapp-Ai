import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedWhatsAppMessage } from "../../../contracts/src/index.js";
import { DomainError } from "../../../persistence/src/index.js";

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
    const payload = JSON.parse(rawBody) as WhatsAppFixturePayload;
    const messages: NormalizedWhatsAppMessage[] = [];
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        for (const message of change.value.messages ?? []) {
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
