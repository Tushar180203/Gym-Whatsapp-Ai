import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { NormalizedWhatsAppMessage } from "../../contracts/src/index.js";
import { equalIdentityHash, hashChallenge, newChallenge } from "../../messaging/src/whatsapp/link-challenge.js";
import { DomainError } from "./store.js";

export type VerifiedRecipientWriter = (client: PoolClient, identityId: string) => Promise<void>;

export class WhatsAppLinks {
  constructor(private readonly db: PoolClient, private readonly userId: string) {}
  async issue(expectedHash: string, maskedNumber: string | null, change: boolean, consented: boolean) {
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new DomainError("Invalid claimed identity", "INVALID_NUMBER");
    const current = (await this.db.query("select l.id,i.provider_user_identity_hash from whatsapp_identity_links l join whatsapp_provider_user_identities i on i.id=l.whatsapp_provider_user_identity_id where l.user_id=$1 and l.status='VERIFIED' and l.revoked_at is null", [this.userId])).rows;
    if (current.length && !change) throw new DomainError("Choose change WhatsApp number", "CHANGE_INTENT_REQUIRED");
    if (current.some(row => equalIdentityHash(row.provider_user_identity_hash, expectedHash))) throw new DomainError("Number already verified", "ALREADY_VERIFIED");
    if ((await this.db.query("select count(*)::int n from account_link_tokens where user_id=$1 and created_at>clock_timestamp()-interval '10 minutes'", [this.userId])).rows[0].n >= 10) throw new DomainError("Try again shortly", "RATE_LIMITED");
    await this.db.query("update account_link_tokens set status='SUPERSEDED' where user_id=$1 and status='PENDING'", [this.userId]);
    const raw = newChallenge();
    const row = (await this.db.query(`insert into account_link_tokens(id,user_id,token_hash,expected_provider_identity_hash,masked_number,change_intent,opt_in_at,expires_at)
      values($1,$2,$3,$4,$5,$6,case when $7 then clock_timestamp() else null end,clock_timestamp()+interval '10 minutes') returning id,expires_at`,
    [randomUUID(), this.userId, hashChallenge(raw), expectedHash, maskedNumber, change, consented])).rows[0];
    return { token: raw, challengeId: row.id as string, expiresAt: row.expires_at.toISOString() as string, maskedNumber };
  }
  async status() {
    const links = (await this.db.query(`select id,status,linked_at as "linkedAt",verified_at as "verifiedAt",revoked_at as "revokedAt",masked_number as "maskedNumber"
      from whatsapp_identity_links where user_id=$1 order by linked_at desc,id`, [this.userId])).rows;
    const pending = (await this.db.query(`select id,masked_number as "maskedNumber",expires_at as "expiresAt",change_intent as "change"
      from account_link_tokens where user_id=$1 and status='PENDING' and expires_at>clock_timestamp()`, [this.userId])).rows[0] ?? null;
    const verified = links.find(row => row.status === "VERIFIED") ?? null;
    return { status: verified ? "VERIFIED" : pending ? "PENDING" : links.length ? "REVOKED" : "NOT_CONNECTED", verified, pending, links };
  }
  async revoke(linkId: string) {
    const previous = (await this.db.query("select status from whatsapp_identity_links where id=$1 and user_id=$2 for update", [linkId, this.userId])).rows[0];
    if (!previous) throw new DomainError("Link not found", "NOT_FOUND");
    if (previous.status === "REVOKED") return { revoked: true };
    const row = (await this.db.query("update whatsapp_identity_links set status='REVOKED',revoked_at=coalesce(revoked_at,clock_timestamp()) where id=$1 and user_id=$2 returning whatsapp_provider_user_identity_id", [linkId, this.userId])).rows[0];
    if (!row) throw new DomainError("Link not found", "NOT_FOUND");
    await this.db.query("update account_link_tokens set status='SUPERSEDED' where user_id=$1 and status='PENDING'", [this.userId]);
    await this.db.query("delete from whatsapp_recipient_addresses where identity_id=$1 and not exists(select 1 from whatsapp_identity_links where whatsapp_provider_user_identity_id=$1 and status='VERIFIED')", [row.whatsapp_provider_user_identity_id]);
    return { revoked: true };
  }
}

export async function verifyWhatsAppChallenge(db: PoolClient, message: NormalizedWhatsAppMessage, code: string | null, writeRecipient?: VerifiedRecipientWriter) {
  const rejected = (body = "That verification code is unavailable. Generate a new one from the website.") => ({ body, verificationRejected: true as const });
  if (!code || message.provider !== "WHATSAPP_CLOUD_API") return rejected();
  const candidate = (await db.query("select user_id from account_link_tokens where token_hash=$1", [hashChallenge(code)])).rows[0];
  if (!candidate) return rejected();
  // Same lock order as authenticated challenge creation, replacement and disconnect.
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [candidate.user_id]);
  const challenge = (await db.query("select *,expires_at>clock_timestamp() as unexpired from account_link_tokens where token_hash=$1 for update", [hashChallenge(code)])).rows[0];
  if (!challenge || challenge.status !== "PENDING") return rejected();
  if (!challenge.unexpired) {
    await db.query("update account_link_tokens set status='EXPIRED' where id=$1", [challenge.id]);
    return rejected("That verification code has expired. Generate a new one from the website.");
  }
  if (!(await db.query("select id from users where id=$1 and deleted_at is null", [challenge.user_id])).rows.length) return rejected();
  if (!equalIdentityHash(challenge.expected_provider_identity_hash, message.providerUserIdentityHash)) {
    // Failed attempts never consume the rightful owner's challenge. Existing sender rate limits remain authoritative.
    await db.query("update account_link_tokens set attempt_count=least(attempt_count+1,20) where id=$1", [challenge.id]);
    return rejected("This verification link doesn't match the WhatsApp number entered on the website.");
  }
  if (challenge.opt_in_at && !writeRecipient) throw new DomainError("Verification transport unavailable", "VERIFICATION_UNAVAILABLE");
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [`whatsapp:${message.providerAccountId}:${message.providerUserIdentityHash}`]);
  await db.query("insert into whatsapp_provider_accounts(id,provider,provider_account_id) values($1,'WHATSAPP_CLOUD_API',$2) on conflict(provider,provider_account_id) do nothing", [randomUUID(), message.providerAccountId]);
  const account = (await db.query("select id from whatsapp_provider_accounts where provider='WHATSAPP_CLOUD_API' and provider_account_id=$1", [message.providerAccountId])).rows[0];
  await db.query("insert into whatsapp_provider_user_identities(id,whatsapp_provider_account_id,provider_user_identity_hash) values($1,$2,$3) on conflict(whatsapp_provider_account_id,provider_user_identity_hash) do nothing", [randomUUID(), account.id, message.providerUserIdentityHash]);
  const identity = (await db.query("select id from whatsapp_provider_user_identities where whatsapp_provider_account_id=$1 and provider_user_identity_hash=$2 for update", [account.id, message.providerUserIdentityHash])).rows[0];
  const existing = (await db.query("select id,user_id from whatsapp_identity_links where whatsapp_provider_user_identity_id=$1 and status='VERIFIED' and revoked_at is null", [identity.id])).rows[0];
  if (existing && existing.user_id !== challenge.user_id) return rejected("This WhatsApp account cannot be connected. Disconnect its existing link before trying again.");
  const old = (await db.query("select id,whatsapp_provider_user_identity_id from whatsapp_identity_links where user_id=$1 and status='VERIFIED' and revoked_at is null", [challenge.user_id])).rows;
  if (old.some(row => row.whatsapp_provider_user_identity_id !== identity.id) && !challenge.change_intent) return rejected();
  for (const row of old.filter(row => row.whatsapp_provider_user_identity_id !== identity.id)) {
    await db.query("update whatsapp_identity_links set status='REVOKED',revoked_at=clock_timestamp() where id=$1", [row.id]);
    await db.query("delete from whatsapp_recipient_addresses where identity_id=$1", [row.whatsapp_provider_user_identity_id]);
  }
  const linkId: string = existing?.id ?? randomUUID();
  if (!existing) await db.query(`insert into whatsapp_identity_links(id,user_id,whatsapp_provider_user_identity_id,linked_at,verified_at,masked_number,opt_in_at,verification_challenge_id)
    values($1,$2,$3,clock_timestamp(),clock_timestamp(),$4,$5,$6)`, [linkId, challenge.user_id, identity.id, challenge.masked_number, challenge.opt_in_at, challenge.id]);
  // Runtime supplies this closure from the provider boundary, so plaintext addressing never enters workout/domain services.
  if (writeRecipient) await writeRecipient(db, identity.id);
  await db.query("update account_link_tokens set status='CONSUMED',consumed_at=clock_timestamp() where id=$1", [challenge.id]);
  return { userId: challenge.user_id as string, linkId, body: "WhatsApp connected successfully. You can now receive and log your workouts.", verificationRejected: false as const };
}

export async function queuePlanReady(db: PoolClient, userId: string, onlyLinkId?: string, accountId?: string) {
  const rows = (await db.query(`select l.id link_id,i.provider_user_identity_hash,a.provider_account_id,r.id routine_id,r.version,r.name
    from whatsapp_identity_links l join whatsapp_provider_user_identities i on i.id=l.whatsapp_provider_user_identity_id
    join whatsapp_provider_accounts a on a.id=i.whatsapp_provider_account_id
    join routines r on r.user_id=l.user_id and r.archived_at is null
    where l.user_id=$1 and l.status='VERIFIED' and l.revoked_at is null and l.opt_in_at is not null
    and ($2::text is null or l.id=$2) and ($3::text is null or a.provider_account_id=$3)
    and exists(select 1 from workout_session_templates t join planned_exercises p on p.session_template_id=t.id and p.removed_at is null where t.routine_id=r.id and t.archived_at is null)`, [userId, onlyLinkId ?? null, accountId ?? null])).rows;
  for (const row of rows) {
    const body = `Your workout plan ${row.name} is ready. Send start when you want to train.`;
    await db.query(`insert into outbound_messages(id,user_id,provider_account_id,provider_user_identity_hash,body_hash,body,status,notification_key,notification_link_id,owner_generation)
      values($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,(select data_control_generation from users where id=$2)) on conflict(notification_key) do nothing`,
    [randomUUID(), userId, row.provider_account_id, row.provider_user_identity_hash, hashChallenge(body), body, `plan-ready:${row.link_id}:${row.routine_id}:${row.version}`, row.link_id]);
  }
}
