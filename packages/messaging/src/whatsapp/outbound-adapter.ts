import { z } from "zod";
import { TransportError, type MessagingTransport, type RecipientResolver, type SendInput } from "../transport.js";

const successSchema = z.object({ messages: z.array(z.object({ id: z.string().min(1).max(512) })).length(1) });
export function providerFailure(status: number): TransportError {
  if (status === 429) return new TransportError("RETRYABLE", "PROVIDER_RATE_LIMIT", true, status);
  if (status === 401 || status === 403) return new TransportError("CONFIGURATION", "PROVIDER_AUTH", false, status);
  if (status >= 500) return new TransportError("UNKNOWN", "PROVIDER_SERVER_ERROR", false, status);
  return new TransportError("PERMANENT", "PROVIDER_REJECTED", false, status);
}

export class WhatsAppOutboundAdapter implements MessagingTransport {
  constructor(private readonly config: {
    accessToken: string; phoneNumberId: string; apiVersion: string; resolver: RecipientResolver;
    fetch?: typeof fetch; timeoutMs?: number;
    /** Only injected by controlled HTTP tests; production factory fixes the Meta origin. */
    testOrigin?: string;
  }) {
    if (!config.accessToken || !/^\d+$/.test(config.phoneNumberId) || !/^v\d+\.\d+$/.test(config.apiVersion)) throw new TransportError("CONFIGURATION", "PROVIDER_CONFIG_INVALID");
    if (config.testOrigin && !/^http:\/\/127\.0\.0\.1:\d+$/.test(config.testOrigin)) throw new TransportError("CONFIGURATION", "TEST_ORIGIN_INVALID");
  }
  async sendMessage(input: SendInput) {
    const recipient = await this.config.resolver.resolve(input.recipientIdentityId);
    if (!/^\d{5,20}$/.test(recipient.address)) throw new TransportError("INVALID_RECIPIENT", "RECIPIENT_INVALID");
    const age = Date.now() - recipient.lastInboundAt.getTime();
    if (!Number.isFinite(age) || age < -60_000 || age >= 24 * 60 * 60 * 1000) throw new TransportError("PERMANENT", "SERVICE_WINDOW_CLOSED");
    if (!input.body || input.body.length > 4096) throw new TransportError("PERMANENT", "MESSAGE_LENGTH_INVALID");
    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(`${this.config.testOrigin ?? "https://graph.facebook.com"}/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
        headers: { "authorization": `Bearer ${this.config.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient.address, type: "text", text: { preview_url: false, body: input.body }, biz_opaque_callback_data: input.idempotencyKey })
      });
    } catch { throw new TransportError("UNKNOWN", "PROVIDER_CONNECTION_OR_TIMEOUT"); }
    if (!response.ok) throw providerFailure(response.status);
    try {
      const result = successSchema.parse(await response.json());
      return { providerMessageId: result.messages[0]!.id };
    } catch { throw new TransportError("UNKNOWN", "PROVIDER_INVALID_RESPONSE", false, response.status); }
  }
}
