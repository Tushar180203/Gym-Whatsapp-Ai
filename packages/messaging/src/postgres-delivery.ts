import type { Pool } from "pg";
import type { NormalizedWhatsAppMessage } from "../../contracts/src/index.js";
import type { SafeEvent } from "../../domain/src/observability/events.js";
import { TransportError, type MessagingTransport } from "./transport.js";

export class PostgresDelivery {
  constructor(private readonly pool: Pool, private readonly transport: MessagingTransport, private readonly observe?: (event: SafeEvent) => void) {}

  async forInbound(message: NormalizedWhatsAppMessage): Promise<string> {
    const row = (await this.pool.query(`select o.id from outbound_messages o join inbound_messages m on m.id=o.inbound_message_id
      where m.provider=$1 and m.provider_account_id=$2 and m.provider_message_id=$3 and m.provider_user_identity_hash=$4`,
    [message.provider, message.providerAccountId, message.providerMessageId, message.providerUserIdentityHash])).rows[0];
    return row ? this.deliver(row.id) : "NO_RESPONSE";
  }

  async notificationsForUser(userId: string): Promise<void> {
    const rows = (await this.pool.query("select id from outbound_messages where user_id=$1 and notification_key is not null and status in ('PENDING','FAILED_RETRYABLE') order by created_at,id limit 20", [userId])).rows;
    for (const row of rows) await this.deliver(row.id);
  }

  async deliver(logicalId: string): Promise<string> {
    const client = await this.pool.connect();
    let lockedUser: string | undefined;
    let released = false;
    try {
      const owner = (await client.query("select user_id from outbound_messages where id=$1", [logicalId])).rows[0];
      if (!owner) return "NOT_FOUND";
      const lock = (await client.query("select pg_try_advisory_lock(hashtext($1)) as locked", [owner.user_id])).rows[0];
      if (!lock.locked) return "BUSY";
      lockedUser = owner.user_id;
      // The owner lock also excludes account/workout deletion while this short, bounded send runs.
      const row = (await client.query(`select o.*,u.deleted_at,u.data_control_generation as current_generation,
          coalesce(m.data_control_generation,o.owner_generation) as data_control_generation,i.id as identity_id from outbound_messages o
        join users u on u.id=o.user_id left join inbound_messages m on m.id=o.inbound_message_id
        left join whatsapp_provider_accounts a on a.provider='WHATSAPP_CLOUD_API' and a.provider_account_id=o.provider_account_id
        left join whatsapp_provider_user_identities i on i.whatsapp_provider_account_id=a.id and i.provider_user_identity_hash=o.provider_user_identity_hash
        left join whatsapp_identity_links l on l.whatsapp_provider_user_identity_id=i.id and l.user_id=o.user_id and l.revoked_at is null and l.status='VERIFIED'
        where o.id=$1 and l.id is not null and (o.notification_link_id is null or o.notification_link_id=l.id)`, [logicalId])).rows[0];
      if (!row || row.deleted_at || row.current_generation !== row.data_control_generation) return "BLOCKED";
      if (row.status === "SENT" || row.provider_outbound_message_id) return "SENT";
      if (row.notification_key?.startsWith("plan-ready:") && !(await client.query("select id from outbound_messages where user_id=$1 and notification_key=$2 and status='SENT' and provider_outbound_message_id is not null", [owner.user_id, `welcome:${row.notification_link_id}`])).rows.length) return "WAITING_FOR_WELCOME";
      if (row.status === "SENDING") {
        // A crash can occur after Meta accepts but before the local result commits. Never blindly resend.
        if (new Date(row.attempt_started_at).getTime() < Date.now() - 60_000) {
          await client.query(`update outbound_messages set status='FAILED_FINAL',safe_to_retry=false,reconciliation_state='DELIVERY_UNKNOWN',error_category='ATTEMPT_INTERRUPTED' where id=$1`, [logicalId]);
          await client.query(`update outbound_delivery_attempts set outcome='UNKNOWN',completed_at=now(),error_category='ATTEMPT_INTERRUPTED' where outbound_message_id=$1 and outcome='SENDING'`, [logicalId]);
        }
        return "DELIVERY_UNKNOWN";
      }
      if (!row.safe_to_retry || row.attempt_count >= 3 || (row.next_attempt_at && new Date(row.next_attempt_at).getTime() > Date.now())) return "NOT_RETRYABLE";
      const attempt = row.attempt_count + 1;
      await client.query("begin");
      const claimed = await client.query(`update outbound_messages set status='SENDING',recipient_identity_id=$2,attempt_count=$3,attempt_started_at=now(),next_attempt_at=null
        where id=$1 and provider_outbound_message_id is null and safe_to_retry returning id`, [logicalId, row.identity_id, attempt]);
      if (!claimed.rows.length) { await client.query("commit"); return "NOT_RETRYABLE"; }
      await client.query(`insert into outbound_delivery_attempts(outbound_message_id,attempt_number,outcome) values($1,$2,'SENDING')`, [logicalId, attempt]);
      await client.query("commit");
      this.observe?.({ event: "outbound_delivery", outboundId: logicalId, recipientIdentityId: row.identity_id, status: "SENDING" });
      try {
        const result = await this.transport.sendMessage({ recipientIdentityId: row.identity_id, body: row.body, idempotencyKey: logicalId });
        await client.query("begin");
        await client.query(`update outbound_messages set status='SENT',provider_outbound_message_id=$2,sent_at=coalesce(sent_at,now()),safe_to_retry=false,
          reconciliation_state='PROVIDER_ACCEPTED',error_category=CASE WHEN delivery_status='failed' THEN 'PROVIDER_DELIVERY_FAILED' ELSE null END
          where id=$1 and (provider_outbound_message_id is null or provider_outbound_message_id=$2)`, [logicalId, result.providerMessageId]);
        await client.query(`update outbound_delivery_attempts set outcome='ACCEPTED',completed_at=now() where outbound_message_id=$1 and attempt_number=$2`, [logicalId, attempt]);
        await client.query("commit");
        this.observe?.({ event: "outbound_delivery", outboundId: logicalId, recipientIdentityId: row.identity_id, status: "SENT" });
        return "SENT";
      } catch (error) {
        await client.query("rollback");
        const failure = error instanceof TransportError ? error : new TransportError("UNKNOWN", "TRANSPORT_UNEXPECTED_FAILURE");
        await client.query("begin");
        // A signed receipt may have independently established acceptance while the HTTP request timed out.
        await client.query(`update outbound_messages set status=CASE WHEN $3 THEN 'FAILED_RETRYABLE' ELSE 'FAILED_FINAL' END,error_category=$2,safe_to_retry=$3,
          reconciliation_state=$4,next_attempt_at=now()+($5 * interval '1 second') where id=$1 and provider_outbound_message_id is null`,
        [logicalId, failure.code, failure.safeToRetry && attempt < 3, failure.category === "UNKNOWN" ? "DELIVERY_UNKNOWN" : "CURRENT", 30 * attempt]);
        await client.query(`update outbound_delivery_attempts set outcome=$3,completed_at=now(),error_category=$4,http_status=$5
          where outbound_message_id=$1 and attempt_number=$2 and outcome<>'ACCEPTED'`, [logicalId, attempt, failure.category === "UNKNOWN" ? "UNKNOWN" : "REJECTED", failure.code, failure.httpStatus ?? null]);
        await client.query("commit");
        this.observe?.({ event: "outbound_failure", code: failure.code, outboundId: logicalId, recipientIdentityId: row.identity_id, status: failure.safeToRetry && attempt < 3 ? "FAILED_RETRYABLE" : "FAILED_FINAL" });
        return failure.category;
      }
    } catch (error) { await client.query("rollback"); throw error; }
    finally {
      if (lockedUser) {
        try { await client.query("select pg_advisory_unlock(hashtext($1))", [lockedUser]); }
        catch { client.release(true); released = true; }
      }
      if (!released) client.release();
    }
  }

  async receipt(input: { accountId: string; providerMessageId: string; status: "sent" | "delivered" | "read" | "failed"; timestamp: Date; recipientHash: string; logicalId?: string }): Promise<void> {
    const status = input.status === "read" ? "delivered" : input.status;
    // No workout command is called; correlation is account + recipient scoped, never a request ID alone.
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const updated = await client.query(`update outbound_messages set provider_outbound_message_id=coalesce(provider_outbound_message_id,$2),
      status='SENT',sent_at=coalesce(sent_at,$5),safe_to_retry=false,reconciliation_state='PROVIDER_ACCEPTED',
      delivery_status=CASE WHEN delivery_status='delivered' THEN 'delivered' ELSE $4 END,
      receipt_at=greatest(coalesce(receipt_at,$5),$5),error_category=CASE WHEN delivery_status='delivered' THEN null WHEN $4='failed' THEN 'PROVIDER_DELIVERY_FAILED' ELSE null END
      where provider_account_id=$1 and provider_user_identity_hash=$3
      and (provider_outbound_message_id=$2 or (id=$6 and attempt_count>0 and reconciliation_state not like 'LEGACY%'))
      and (provider_outbound_message_id is null or provider_outbound_message_id=$2)
      and (receipt_at is null or receipt_at <= $5 or $4='delivered') returning id`,
    [input.accountId, input.providerMessageId, input.recipientHash, status, input.timestamp, input.logicalId ?? null]);
      for (const row of updated.rows) await client.query(`update outbound_delivery_attempts set outcome='ACCEPTED',completed_at=coalesce(completed_at,now()) where outbound_message_id=$1 and outcome IN ('SENDING','UNKNOWN')`, [row.id]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }
}
