import { productionApp } from "../../../../server/app.js";
import { WhatsAppInboundAdapter } from "../../../../../../packages/messaging/src/index.js";

import { apiResponse, boundedWebhookBody } from "../../../../server/http.js";
export async function POST(request: Request) {
  return apiResponse(request, async () => {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) throw new Error("WHATSAPP_APP_SECRET required");
    const messages = new WhatsAppInboundAdapter(secret).normalize(await boundedWebhookBody(request), request.headers.get("x-hub-signature-256") ?? "");
    const results = [];
    // Preserve provider batch order; per-user transactions handle independent deliveries.
    for (const message of messages) results.push(await productionApp().processInbound(message));
    return results;
  });
}
