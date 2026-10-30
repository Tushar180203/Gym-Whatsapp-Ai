import { Pool } from "pg";
import { runtimeEnv } from "../packages/contracts/src/env.js";
import { PostgresDelivery } from "../packages/messaging/src/postgres-delivery.js";
import { PostgresRecipientResolver } from "../packages/messaging/src/whatsapp/recipient-resolver.js";
import { WhatsAppOutboundAdapter } from "../packages/messaging/src/whatsapp/outbound-adapter.js";

async function main() {
  const config = runtimeEnv();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  try {
    const [mode = "report", id] = process.argv.slice(2);
    if (mode === "report") {
      const rows = await pool.query(`select id,status,attempt_count,error_category,reconciliation_state,safe_to_retry,next_attempt_at,delivery_status
        from outbound_messages where status<>'SENT' or delivery_status='failed' order by id limit 100`);
      console.log(JSON.stringify(rows.rows, null, 2));
    } else if (mode === "retry" && id && /^outbound_[a-zA-Z0-9_-]+$/.test(id)) {
      if (config.WHATSAPP_PROVIDER !== "cloud_api") throw new Error("WHATSAPP_PROVIDER must be cloud_api for retry");
      const resolver = new PostgresRecipientResolver(pool, config.WHATSAPP_RECIPIENT_ENCRYPTION_KEY!, config.WHATSAPP_PHONE_NUMBER_ID!);
      const adapter = new WhatsAppOutboundAdapter({ accessToken: config.WHATSAPP_ACCESS_TOKEN!, phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID!, apiVersion: config.WHATSAPP_GRAPH_API_VERSION!, resolver });
      console.log(JSON.stringify({ id, result: await new PostgresDelivery(pool, adapter).deliver(id) }));
    } else throw new Error("Usage: whatsapp:delivery [report | retry outbound_ID]");
  } finally { await pool.end(); }
}
main().catch(() => { console.error("Delivery operation failed; check configuration/database and safe delivery status."); process.exitCode = 1; });
