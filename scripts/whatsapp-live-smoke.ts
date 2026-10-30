import { Pool } from "pg";
import { runtimeEnv } from "../packages/contracts/src/env.js";

async function main() {
  if (process.env.RUN_LIVE_WHATSAPP !== "1") throw new Error("Live WhatsApp smoke is opt-in only");
  const config = runtimeEnv();
  const inboundId = process.env.WHATSAPP_LIVE_INBOUND_MESSAGE_ID;
  if (config.WHATSAPP_PROVIDER !== "cloud_api" || !config.APP_ORIGIN?.startsWith("https://") || !inboundId) throw new Error("Live smoke requires enabled transport, HTTPS origin and an operator-supplied inbound message ID");
  const challenge = "24681357";
  const url = new URL("/api/webhooks/whatsapp", config.APP_ORIGIN);
  url.searchParams.set("hub.mode", "subscribe"); url.searchParams.set("hub.verify_token", config.WHATSAPP_VERIFY_TOKEN!); url.searchParams.set("hub.challenge", challenge);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok || await response.text() !== challenge) throw new Error("Webhook verification failed");
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  try {
    const rows = (await pool.query(`select m.processing_status,o.status,o.provider_outbound_message_id,o.attempt_count,o.delivery_status
      from inbound_messages m join outbound_messages o on o.inbound_message_id=m.id
      where m.provider='WHATSAPP_CLOUD_API' and m.provider_account_id=$1 and m.provider_message_id=$2`, [config.WHATSAPP_PHONE_NUMBER_ID, inboundId])).rows;
    if (rows.length !== 1 || rows[0].processing_status !== "COMPLETED" || rows[0].status !== "SENT" || !rows[0].provider_outbound_message_id || rows[0].delivery_status === "failed") throw new Error("Inbound message does not have one provider-accepted outbound response");
    console.log(JSON.stringify({ verification: "PASS", inbound: "COMPLETED", logicalResponses: 1, providerAcceptance: "PASS", deliveryStatus: rows[0].delivery_status ?? "AWAITING_RECEIPT" }));
  } finally { await pool.end(); }
}
main().catch(() => { console.error("Live WhatsApp smoke failed. Check configuration, verified webhook setup and the manually sent test message; secrets are not printed."); process.exitCode = 1; });
