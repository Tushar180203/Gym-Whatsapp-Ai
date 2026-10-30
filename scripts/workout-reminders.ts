import { Pool } from "pg";
import { runtimeEnv } from "../packages/contracts/src/env.js";
import { queueWorkoutReminders } from "../packages/persistence/src/workout-reminders.js";
import { PostgresDelivery } from "../packages/messaging/src/postgres-delivery.js";
import { PostgresRecipientResolver } from "../packages/messaging/src/whatsapp/recipient-resolver.js";
import { WhatsAppOutboundAdapter } from "../packages/messaging/src/whatsapp/outbound-adapter.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--send", "--watch"].includes(arg))) throw new Error("Use --send and/or --watch");
  const send = args.includes("--send"), watch = args.includes("--watch"), config = runtimeEnv();
  if (send && config.WHATSAPP_PROVIDER !== "cloud_api") throw new Error("WhatsApp transport must be configured");
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const options = { accountId: config.WHATSAPP_PHONE_NUMBER_ID ?? "", ...(config.WHATSAPP_REMINDER_TEMPLATE_NAME ? { template: { name: config.WHATSAPP_REMINDER_TEMPLATE_NAME, languageCode: config.WHATSAPP_REMINDER_TEMPLATE_LANGUAGE } } : {}) };
  const delivery = send ? new PostgresDelivery(pool, new WhatsAppOutboundAdapter({ accessToken: config.WHATSAPP_ACCESS_TOKEN!, phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID!, apiVersion: config.WHATSAPP_GRAPH_API_VERSION!, resolver: new PostgresRecipientResolver(pool, config.WHATSAPP_RECIPIENT_ENCRYPTION_KEY!, config.WHATSAPP_PHONE_NUMBER_ID!) })) : null;
  let stop = false, releaseWait: (() => void) | undefined;
  const terminate = () => { stop = true; releaseWait?.(); };
  process.once("SIGTERM", terminate); process.once("SIGINT", terminate);
  async function tick() {
    const counts = await queueWorkoutReminders(pool, options, new Date(), !send);
    let accepted = 0, blocked = 0;
    if (delivery) {
      const pending = (await pool.query(`select id from outbound_messages where notification_key like 'workout-reminder:%'
        and provider_account_id=$1 and status in ('PENDING','FAILED_RETRYABLE') and safe_to_retry
        and (next_attempt_at is null or next_attempt_at<=clock_timestamp()) order by created_at,id limit 100`, [options.accountId])).rows;
      for (const row of pending) { if (stop) break; const result = await delivery.deliver(row.id); if (result === "SENT") accepted++; else blocked++; }
    }
    console.log(JSON.stringify({ mode: send ? "send" : "preview", ...counts, accepted, blocked }));
  }
  try {
    do {
      try { await tick(); } catch { console.error("Reminder tick failed; check application configuration and database availability."); if (!watch) { process.exitCode = 1; break; } }
      if (watch && !stop) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 30_000); releaseWait = () => { clearTimeout(timer); resolve(); }; });
    } while (watch && !stop);
  } finally { process.removeListener("SIGTERM", terminate); process.removeListener("SIGINT", terminate); await pool.end(); }
}
main().catch(() => { console.error("Reminder worker could not start; check configuration. No details or credentials are logged."); process.exitCode = 1; });
