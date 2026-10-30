import { productionApp } from "../../../../server/app.js";
import { WhatsAppInboundAdapter } from "../../../../../../packages/messaging/src/index.js";

import { apiResponse, boundedWebhookBody } from "../../../../server/http.js";
import { verifyChallenge } from "../../../../../../packages/messaging/src/whatsapp/verification.js";
import { whatsappTransport } from "../../../../server/whatsapp/transport.js";
import { PostgresRecipientResolver } from "../../../../../../packages/messaging/src/whatsapp/recipient-resolver.js";

export async function GET(request: Request) {
  return verifyChallenge(request.url, process.env.WHATSAPP_VERIFY_TOKEN);
}
export async function POST(request: Request) {
  return apiResponse(request, async () => {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) throw new Error("WHATSAPP_APP_SECRET required");
    const raw = await boundedWebhookBody(request);
    const signature = request.headers.get("x-hub-signature-256") ?? "";
    const adapter = new WhatsAppInboundAdapter(secret);
    // Authenticate even before building runtime services; invalid requests cannot invoke AI or access recipients.
    adapter.verifyWebhookPost(raw, signature);
    const transport = whatsappTransport();
    const recipients = transport?.recipients ?? (process.env.WHATSAPP_RECIPIENT_ENCRYPTION_KEY && process.env.WHATSAPP_PHONE_NUMBER_ID
      ? new PostgresRecipientResolver(productionApp().pool, process.env.WHATSAPP_RECIPIENT_ENCRYPTION_KEY, process.env.WHATSAPP_PHONE_NUMBER_ID) : undefined);
    const accountId = transport?.accountId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
    const batch = recipients && accountId ? adapter.decodeProduction(raw, signature, accountId) : undefined;
    const messages = batch?.messages ?? adapter.normalize(raw, signature);
    const results = [];
    // Preserve provider batch order; per-user transactions handle independent deliveries.
    for (const message of messages) {
      const recipient = batch?.recipients.find(item => item.messageId === message.providerMessageId && item.identityHash === message.providerUserIdentityHash);
      const result = await productionApp().processInbound(message, {
        ...(recipients && recipient ? { writeVerifiedRecipient: (client, identityId) => recipients.remember(recipient, client, identityId) } : {})
      });
      if (result.verificationRejected) { results.push(result); continue; }
      if (transport && batch) {
        await transport.recipients.remember(recipient!);
        await transport.delivery.forInbound(message);
        const owner = (await productionApp().pool.query("select user_id from inbound_messages where provider_account_id=$1 and provider_message_id=$2", [message.providerAccountId, message.providerMessageId])).rows[0];
        if (owner) await transport.delivery.notificationsForUser(owner.user_id);
      }
      results.push(result);
    }
    if (transport && batch) for (const receipt of batch.receipts) await transport.delivery.receipt(receipt);
    return results;
  });
}
