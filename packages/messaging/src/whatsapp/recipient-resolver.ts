import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { TransportError, type RecipientResolver } from "../transport.js";

export class RecipientCipher {
  private readonly key: Buffer;
  constructor(key: string) {
    if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new TransportError("CONFIGURATION", "RECIPIENT_KEY_INVALID");
    this.key = Buffer.from(key, "hex");
  }
  encrypt(address: string, identityId: string): string {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(identityId));
    const encrypted = Buffer.concat([cipher.update(address, "utf8"), cipher.final()]);
    return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
  }
  decrypt(value: string, identityId: string): string {
    try {
      const [version, iv, tag, data] = value.split(":");
      if (version !== "v1" || !iv || !tag || !data) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "hex"));
      decipher.setAAD(Buffer.from(identityId)); decipher.setAuthTag(Buffer.from(tag, "hex"));
      return Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");
    } catch { throw new TransportError("CONFIGURATION", "RECIPIENT_DECRYPTION_FAILED"); }
  }
}

export class PostgresRecipientResolver implements RecipientResolver {
  readonly cipher: RecipientCipher;
  constructor(private readonly pool: Pool, key: string, private readonly accountId: string) { this.cipher = new RecipientCipher(key); }
  async remember(input: { accountId: string; identityHash: string; address: string; timestamp: Date }, transaction?: PoolClient, expectedIdentityId?: string): Promise<void> {
    const db = transaction ?? this.pool;
    if (input.accountId !== this.accountId || !/^\d{5,20}$/.test(input.address) || createHash("sha256").update(input.address).digest("hex") !== input.identityHash) throw new TransportError("INVALID_RECIPIENT", "RECIPIENT_INVALID");
    const identity = (await db.query(`select i.id from whatsapp_provider_user_identities i
      join whatsapp_provider_accounts a on a.id=i.whatsapp_provider_account_id
      join whatsapp_identity_links l on l.whatsapp_provider_user_identity_id=i.id and l.revoked_at is null and l.status='VERIFIED'
      join users u on u.id=l.user_id and u.deleted_at is null
      where a.provider='WHATSAPP_CLOUD_API' and a.provider_account_id=$1 and i.provider_user_identity_hash=$2`, [input.accountId, input.identityHash])).rows[0];
    if (!identity || expectedIdentityId && identity.id !== expectedIdentityId) throw new TransportError("INVALID_RECIPIENT", "RECIPIENT_UNLINKED");
    await db.query(`insert into whatsapp_recipient_addresses(identity_id,address_ciphertext,last_inbound_at)
      values($1,$2,$3) on conflict(identity_id) do update set address_ciphertext=excluded.address_ciphertext,
      last_inbound_at=greatest(whatsapp_recipient_addresses.last_inbound_at,excluded.last_inbound_at)`, [identity.id, this.cipher.encrypt(input.address, identity.id), input.timestamp]);
  }
  async resolve(identityId: string) {
    const row = (await this.pool.query(`select r.address_ciphertext,r.last_inbound_at from whatsapp_recipient_addresses r
      join whatsapp_provider_user_identities i on i.id=r.identity_id
      join whatsapp_provider_accounts a on a.id=i.whatsapp_provider_account_id
      join whatsapp_identity_links l on l.whatsapp_provider_user_identity_id=i.id and l.revoked_at is null and l.status='VERIFIED'
      join users u on u.id=l.user_id and u.deleted_at is null
      where i.id=$1 and a.provider='WHATSAPP_CLOUD_API' and a.provider_account_id=$2`, [identityId, this.accountId])).rows[0];
    if (!row) throw new TransportError("INVALID_RECIPIENT", "RECIPIENT_UNAVAILABLE", true);
    return { address: this.cipher.decrypt(row.address_ciphertext, identityId), lastInboundAt: new Date(row.last_inbound_at) };
  }
}
