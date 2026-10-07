import { productionApp } from "../../../../server/app.js";
import { WhatsAppInboundAdapter } from "../../../../../../packages/messaging/src/index.js";

import { apiResponse } from "../../../../server/http.js";
export async function POST(request: Request) {
  return apiResponse(request, async () => {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) throw new Error("WHATSAPP_APP_SECRET required");
    const messages = new WhatsAppInboundAdapter(secret).normalize(await request.text(), request.headers.get("x-hub-signature-256") ?? "");
    return Promise.all(messages.map(message => productionApp().processInbound(message)));
  });
}
