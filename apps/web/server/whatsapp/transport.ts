import { runtimeEnv } from "../../../../packages/contracts/src/env.js";
import { PostgresRecipientResolver } from "../../../../packages/messaging/src/whatsapp/recipient-resolver.js";
import { WhatsAppOutboundAdapter } from "../../../../packages/messaging/src/whatsapp/outbound-adapter.js";
import { PostgresDelivery } from "../../../../packages/messaging/src/postgres-delivery.js";
import { productionApp } from "../app.js";
import { observe } from "../observability.js";

let services: { recipients: PostgresRecipientResolver; delivery: PostgresDelivery; accountId: string } | undefined;
export function whatsappTransport() {
  const config = runtimeEnv();
  if (config.WHATSAPP_PROVIDER !== "cloud_api") return undefined;
  if (!services) {
    const pool = productionApp().pool;
    const recipients = new PostgresRecipientResolver(pool, config.WHATSAPP_RECIPIENT_ENCRYPTION_KEY!, config.WHATSAPP_PHONE_NUMBER_ID!);
    const adapter = new WhatsAppOutboundAdapter({ accessToken: config.WHATSAPP_ACCESS_TOKEN!, phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID!, apiVersion: config.WHATSAPP_GRAPH_API_VERSION!, resolver: recipients });
    services = { recipients, delivery: new PostgresDelivery(pool, adapter, observe), accountId: config.WHATSAPP_PHONE_NUMBER_ID! };
  }
  return services;
}
