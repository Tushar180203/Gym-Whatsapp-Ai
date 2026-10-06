import { productionApp } from "../../../../server/app.js";
import { WhatsAppInboundAdapter } from "../../../../../../packages/messaging/src/index.js";

export async function POST(input: { rawBody: string; signature: string; appSecret: string }) {
  const adapter = new WhatsAppInboundAdapter(input.appSecret);
  const messages = adapter.normalize(input.rawBody, input.signature);
  const app = productionApp();
  return Promise.all(messages.map((message) => app.processInbound(message)));
}
