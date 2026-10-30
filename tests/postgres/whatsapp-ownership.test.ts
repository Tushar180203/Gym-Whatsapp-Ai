import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/whatsapp/inbound-adapter.js";
import { PostgresRecipientResolver } from "../../packages/messaging/src/whatsapp/recipient-resolver.js";
import { PostgresDelivery } from "../../packages/messaging/src/postgres-delivery.js";
import { FakeMessagingTransport, TransportError } from "../../packages/messaging/src/transport.js";
import { hashChallenge } from "../../packages/messaging/src/whatsapp/link-challenge.js";
import { readFile } from "node:fs/promises";
let app: PostgresVerticalSliceApp;
let transport: { accountId: string; recipients: PostgresRecipientResolver; delivery: PostgresDelivery };
vi.mock("../../apps/web/server/app.js", () => ({ productionApp: () => app }));
vi.mock("../../apps/web/server/whatsapp/transport.js", () => ({ whatsappTransport: () => transport }));
import { POST as webhook } from "../../apps/web/app/api/webhooks/whatsapp/route.js";
import { POST as challengeRoute } from "../../apps/web/app/api/whatsapp/link-token/route.js";
import { GET as statusRoute } from "../../apps/web/app/api/whatsapp/link/route.js";
import { DELETE as revokeRoute } from "../../apps/web/app/api/whatsapp/link/[id]/route.js";
import { POST as routineRoute } from "../../apps/web/app/api/routines/route.js";
const url = process.env.TEST_DATABASE_URL;
const pgDescribe = url || process.env.REQUIRE_POSTGRES_TESTS === "1" ? describe : describe.skip;
const address = "919685719847", second = "919685719848", accountId = "123456", secret = "ownership-fixture-secret", key = "ab".repeat(32);
const adapter = new WhatsAppInboundAdapter(secret);
pgDescribe("production number ownership", () => {
  let owner: { userId: string; sessionToken: string }, other: typeof owner, scoped: string, fake: FakeMessagingTransport, next: number;
  const interpret = vi.fn();
  beforeEach(async () => {
    if (!url) throw new Error("TEST_DATABASE_URL required");
    const admin = new Pool({ connectionString: url }); await admin.query("drop schema if exists ownership_test cascade"); await admin.query("create schema ownership_test"); await admin.end();
    const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=ownership_test"); scoped = parsed.toString();
    interpret.mockReset(); app = new PostgresVerticalSliceApp({ connectionString: scoped, interpreter: { interpret } }); await app.migrate(); next = 0;
    owner = await app.signUp("owner@example.com", "correct horse battery staple"); other = await app.signUp("other@example.com", "correct horse battery staple");
    await app.configure(owner.sessionToken, c => c.profile({ preferredWeightUnit: "KG" }));
    fake = new FakeMessagingTransport(); services();
    vi.stubEnv("WHATSAPP_APP_SECRET", secret); vi.stubEnv("WHATSAPP_BUSINESS_NUMBER", "+15551234567");
  });
  afterEach(async () => { await app?.close(); vi.unstubAllEnvs(); });
  function services() { transport = { accountId, recipients: new PostgresRecipientResolver(app.pool, key, accountId), delivery: new PostgresDelivery(app.pool, fake) }; }
  function web(path: string, method = "GET", input?: unknown, session = owner.sessionToken) { return new Request(`http://localhost${path}`, { method, headers: { cookie: `workout_session=${session}`, "content-type": "application/json" }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }); }
  async function create(number = address, change = false, session = owner.sessionToken) {
    const response = await challengeRoute(web("/api/whatsapp/link-token", "POST", { phoneNumber: `+${number}`, consent: true, change }, session)); expect(response.status).toBe(200); return response.json();
  }
  function raw(text: string, sender: string, id: string) { return JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: accountId }, messages: [{ id, from: sender, timestamp: String(Math.floor(Date.now()/1000)), text: { body: text } }] } }] }] }); }
  async function send(text: string, sender = address, id = `proof-${next++}`) {
    const body = raw(text, sender, id); const response = await webhook(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body, headers: { "x-hub-signature-256": adapter.sign(body) } }));
    expect(response.status).toBe(200); return (await response.json())[0];
  }
  async function state(session = owner.sessionToken) { const response = await statusRoute(web("/api/whatsapp/link", "GET", undefined, session)); expect(response.status).toBe(200); return response.json(); }
  async function sql(query: string, values: unknown[] = []) { return (await app.pool.query(query, values)).rows; }
  async function plan() {
    const response = await routineRoute(web("/api/routines", "POST", { name: "My plan", sessions: [{ name: "Push", exercises: [{ exerciseIdentityId: "global_barbell_bench_press", plannedSetCount: 1, repTargetMin: 10 }] }] })); expect(response.status).toBe(200); return response.json();
  }
  it("real authenticated APIs claim, prove, persist encrypted sender, notify once and run the workout", async () => {
    await plan(); const challenge = await create(); expect(challenge.whatsappUrl).toContain(`LINK%20${challenge.token}`);
    expect((await state()).status).toBe("PENDING"); expect(await sql("select * from whatsapp_recipient_addresses")).toHaveLength(0);
    await expect(app.processInbound(adapter.normalize(raw("start", address, "unverified"), adapter.sign(raw("start", address, "unverified")))[0]!)).rejects.toMatchObject({ code: "UNLINKED_IDENTITY" });
    await send(`LINK ${challenge.token}`, address, "link-once"); await send(`LINK ${challenge.token}`, address, "link-once"); await send(`LINK ${challenge.token}`);
    const connected = await state(); expect(connected).toMatchObject({ status: "VERIFIED", pending: null, verified: { maskedNumber: "+91 ******9847" } });
    expect((await sql("select status,consumed_at from account_link_tokens"))[0]).toMatchObject({ status: "CONSUMED", consumed_at: expect.any(Date) });
    expect(await sql("select * from whatsapp_identity_links")).toHaveLength(1); expect(fake.calls).toHaveLength(2);
    const recipient = (await sql("select * from whatsapp_recipient_addresses"))[0]; expect(recipient.address_ciphertext).not.toContain(address); expect(await transport.recipients.resolve(recipient.identity_id)).toMatchObject({ address });
    await send("START"); await send("start planned"); await send("45x10", address, "set-once"); await send("45x10", address, "set-once"); await send("done");
    expect((await app.history(owner.userId))[0]!.sets).toHaveLength(1); expect(interpret).not.toHaveBeenCalled();
    expect(JSON.stringify(await sql("select * from account_link_tokens"))).not.toContain(challenge.token);
    expect(JSON.stringify(await sql("select * from inbound_messages"))).not.toContain(challenge.token);
  });
  it("wrong sender never consumes the challenge; expired, malformed and superseded codes cannot link or invoke AI", async () => {
    const first = await create(); expect((await send(`LINK ${first.token}`, second)).body).toContain("doesn't match");
    expect((await state()).status).toBe("PENDING"); expect((await sql("select consumed_at,attempt_count from account_link_tokens"))[0]).toEqual({ consumed_at: null, attempt_count: 1 });
    const replacement = await create(); expect((await send(`LINK ${first.token}`)).verificationRejected).toBe(true);
    await sql("update account_link_tokens set expires_at=clock_timestamp()-interval '1 second' where id=$1", [replacement.challengeId]);
    expect((await send(`LINK ${replacement.token}`)).body).toContain("expired"); await send("LINK invalid");
    expect(await sql("select * from whatsapp_identity_links")).toHaveLength(0); expect(fake.calls).toHaveLength(0); expect(interpret).not.toHaveBeenCalled();
  });
  it("concurrent distinct deliveries consume once, create one verified identity and one welcome/plan response", async () => {
    await plan(); const challenge = await create(); await Promise.all([send(`LINK ${challenge.token}`, address, "parallel-a"), send(`link ${challenge.token.toLowerCase()}`, address, "parallel-b")]);
    expect(await sql("select * from whatsapp_identity_links")).toHaveLength(1); expect(await sql("select * from outbound_messages")).toHaveLength(2);
    await transport.delivery.notificationsForUser(owner.userId); expect(fake.calls).toHaveLength(2);
  });
  it("does not transfer an identity owned by another user or disclose that user's account", async () => {
    await send(`LINK ${(await create()).token}`); const stolen = await create(address, false, other.sessionToken);
    const result = await send(`LINK ${stolen.token}`); expect(result.verificationRejected).toBe(true); expect(result.body).not.toContain(owner.userId); expect(result.body).not.toContain("owner@example.com");
    expect((await state(other.sessionToken)).verified).toBeNull(); expect((await state()).verified).not.toBeNull();
    expect((await sql("select status from account_link_tokens where id=$1", [stolen.challengeId]))[0].status).toBe("PENDING");
  });
  it("requires deliberate change, keeps A usable until B verifies, and atomically switches without old-recipient access", async () => {
    await plan(); await send(`LINK ${(await create()).token}`); const old = (await state()).verified;
    expect((await challengeRoute(web("/api/whatsapp/link-token", "POST", { phoneNumber: `+${second}`, consent: true }))).status).toBe(400);
    const changed = await create(second, true); expect((await state()).verified.id).toBe(old.id); await send("START");
    await send(`LINK ${changed.token}`, second); expect((await state()).verified.maskedNumber).toBe("+91 ******9848");
    await expect(app.processInbound(adapter.normalize(raw("45x10", address, "old-command"), adapter.sign(raw("45x10", address, "old-command")))[0]!)).rejects.toMatchObject({ code: "UNLINKED_IDENTITY" });
    const oldIdentity = (await sql("select whatsapp_provider_user_identity_id from whatsapp_identity_links where id=$1", [old.id]))[0];
    await expect(transport.recipients.resolve(oldIdentity.whatsapp_provider_user_identity_id)).rejects.toMatchObject({ code: "RECIPIENT_UNAVAILABLE" });
  });
  it("confirmation and owner checks guard disconnect; pending codes cannot reactivate and repeated disconnect is harmless", async () => {
    await send(`LINK ${(await create()).token}`); const id = (await state()).verified.id, pending = await create(second, true);
    expect((await revokeRoute(web(`/api/whatsapp/link/${id}`, "DELETE", { confirm: true }, other.sessionToken), { params: Promise.resolve({ id }) })).status).toBe(404);
    expect((await revokeRoute(web(`/api/whatsapp/link/${id}`, "DELETE", {}), { params: Promise.resolve({ id }) })).status).toBe(400);
    for (let n = 0; n < 2; n++) expect((await revokeRoute(web(`/api/whatsapp/link/${id}`, "DELETE", { confirm: true }), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect((await state()).status).toBe("REVOKED"); expect((await send(`LINK ${pending.token}`, second)).verificationRejected).toBe(true);
    await expect(app.processInbound(adapter.normalize(raw("start", address, "revoked"), adapter.sign(raw("start", address, "revoked")))[0]!)).rejects.toMatchObject({ code: "UNLINKED_IDENTITY" });
    expect(await sql("select * from whatsapp_recipient_addresses")).toHaveLength(0);
  });
  it("recipient-write failure rolls back challenge, link and notifications; proof succeeds after restart", async () => {
    const challenge = await create(); const body = raw(`LINK ${challenge.token}`, address, "rollback");
    const message = adapter.normalize(body, adapter.sign(body))[0]!;
    await expect(app.processInbound(message, { writeVerifiedRecipient: async (db, identityId) => { await transport.recipients.remember({ accountId, identityHash: hashChallenge(address), address, timestamp: new Date() }, db, identityId); throw new Error("injected failure"); } })).rejects.toThrow("injected failure");
    expect(await sql("select * from whatsapp_identity_links")).toHaveLength(0); expect(await sql("select * from whatsapp_recipient_addresses")).toHaveLength(0); expect((await state()).status).toBe("PENDING");
    await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scoped, interpreter: { interpret } }); services();
    await send(`LINK ${challenge.token}`); await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scoped }); services();
    expect((await state()).status).toBe("VERIFIED"); expect(fake.calls).toHaveLength(1); expect(await sql("select * from outbound_messages where status='SENT'")).toHaveLength(1);
  });
  it("requires consent, rejects foreign owner fields, bounds creation and prevents deleted-user proof", async () => {
    for (const input of [{ phoneNumber: `+${address}`, consent: false }, { phoneNumber: address, consent: true }, { phoneNumber: `+${address}`, consent: true, userId: other.userId }]) expect((await challengeRoute(web("/api/whatsapp/link-token", "POST", input))).status).toBe(400);
    let challenge;
    for (let n = 0; n < 10; n++) challenge = await create();
    expect((await challengeRoute(web("/api/whatsapp/link-token", "POST", { phoneNumber: `+${address}`, consent: true }))).status).toBe(429);
    await sql("update users set deleted_at=clock_timestamp() where id=$1", [owner.userId]);
    expect((await send(`LINK ${challenge.token}`)).verificationRejected).toBe(true); expect(await sql("select * from whatsapp_identity_links")).toHaveLength(0);
    expect((await statusRoute(web("/api/whatsapp/link"))).status).toBe(401); expect(interpret).not.toHaveBeenCalled();
  });
  it("plan saved after verification creates one durable versioned intent without another welcome", async () => {
    await send(`LINK ${(await create()).token}`); expect(fake.calls).toHaveLength(1);
    await plan(); expect(fake.calls).toHaveLength(2); await transport.delivery.notificationsForUser(owner.userId); expect(fake.calls).toHaveLength(2);
    expect((await sql("select notification_key from outbound_messages where notification_key like 'plan-ready:%'"))[0].notification_key).toMatch(/^plan-ready:/);
  });
  it("durable welcome retry precedes plan-ready and neither notification is duplicated", async () => {
    await plan(); const challenge = await create(); fake.failure = new TransportError("RETRYABLE", "PROVIDER_RATE_LIMITED", true, 429);
    await send(`LINK ${challenge.token}`, address, "welcome-retry");
    expect(fake.calls).toHaveLength(1); expect((await sql("select status from outbound_messages where notification_key like 'plan-ready:%'"))[0].status).toBe("PENDING");
    fake.failure = undefined; await sql("update outbound_messages set next_attempt_at=clock_timestamp()-interval '1 second' where notification_key like 'welcome:%'");
    await send(`LINK ${challenge.token}`, address, "welcome-retry");
    expect(fake.calls).toHaveLength(3); expect(fake.calls[1]!.body).toContain("WhatsApp connected"); expect(fake.calls[2]!.body).toContain("Your workout plan");
    await send(`LINK ${challenge.token}`, address, "welcome-retry"); expect(fake.calls).toHaveLength(3);
  });
  it("upgrades populated Phase B preserving proven links/ciphertext but disabling unbound outstanding tokens", async () => {
    const admin = new Pool({ connectionString: url }); await admin.query("drop schema if exists ownership_upgrade_test cascade"); await admin.query("create schema ownership_upgrade_test"); await admin.end();
    const parsed = new URL(url!); parsed.searchParams.set("options", "-c search_path=ownership_upgrade_test"); const upgrade = new PostgresVerticalSliceApp({ connectionString: parsed.toString() });
    try {
      await upgrade.pool.query("create table schema_migrations(name text primary key)");
      for (const name of ["0001_vertical_slice.sql","0002_us4.sql","0003_us5.sql","0004_us6.sql","0005_us7.sql","0006_release_integrity.sql","0007_core_configuration.sql","0008_whatsapp_transport.sql"]) {
        await upgrade.pool.query(await readFile(`packages/persistence/migrations/${name}`, "utf8")); await upgrade.pool.query("insert into schema_migrations(name) values($1)", [name]);
      }
      const auth = await upgrade.signUp("legacy-proof@example.com", "correct horse battery staple");
      await upgrade.pool.query("insert into whatsapp_provider_accounts(id,provider,provider_account_id) values('legacy-a','WHATSAPP_CLOUD_API',$1)", [accountId]);
      await upgrade.pool.query("insert into whatsapp_provider_user_identities(id,whatsapp_provider_account_id,provider_user_identity_hash) values('legacy-i','legacy-a',$1)", [hashChallenge(address)]);
      await upgrade.pool.query("insert into whatsapp_identity_links(id,user_id,whatsapp_provider_user_identity_id,linked_at) values('legacy-l',$1,'legacy-i',now())", [auth.userId]);
      const cipher = transport.recipients.cipher.encrypt(address, "legacy-i");
      await upgrade.pool.query("insert into whatsapp_recipient_addresses(identity_id,address_ciphertext,last_inbound_at) values('legacy-i',$1,now())", [cipher]);
      await upgrade.pool.query("insert into account_link_tokens(id,user_id,token_hash,expires_at) values('legacy-token',$1,$2,now()+interval '10 minutes')", [auth.userId, hashChallenge("old-unbound-token")]);
      await upgrade.migrate(); await upgrade.migrate();
      expect((await upgrade.configure(auth.sessionToken, c => c.links())).status).toBe("VERIFIED");
      expect((await upgrade.pool.query("select address_ciphertext from whatsapp_recipient_addresses")).rows[0].address_ciphertext).toBe(cipher);
      expect((await upgrade.pool.query("select status from account_link_tokens")).rows[0].status).toBe("SUPERSEDED");
      const resolver = new PostgresRecipientResolver(upgrade.pool, key, accountId); expect(await resolver.resolve("legacy-i")).toMatchObject({ address });
      const body = raw("LINK old-unbound-token", second, "legacy-code"); expect((await upgrade.processInbound(adapter.normalize(body, adapter.sign(body))[0]!)).verificationRejected).toBe(true);
      expect((await upgrade.pool.query("select count(*)::int n from whatsapp_identity_links")).rows[0].n).toBe(1);
    } finally { await upgrade.close(); }
  });
  it("database enforces one pending claim and challenge/link/outbound ownership independent of application checks", async () => {
    const challenge = await create();
    await expect(app.pool.query("insert into account_link_tokens(id,user_id,token_hash,expected_provider_identity_hash,expires_at) values('duplicate',$1,$2,$3,now()+interval '10 minutes')", [owner.userId, hashChallenge("different"), hashChallenge(address)])).rejects.toMatchObject({ code: "23505" });
    await send(`LINK ${challenge.token}`); const verified = (await state()).verified;
    await expect(app.pool.query("update whatsapp_identity_links set user_id=$1 where id=$2", [other.userId, verified.id])).rejects.toMatchObject({ code: "23503" });
    await expect(app.pool.query("update outbound_messages set user_id=$1 where notification_link_id=$2", [other.userId, verified.id])).rejects.toMatchObject({ code: "23503" });
    await expect(app.pool.query("update whatsapp_identity_links set status='REVOKED' where id=$1", [verified.id])).rejects.toMatchObject({ code: "23514" });
  });
});
