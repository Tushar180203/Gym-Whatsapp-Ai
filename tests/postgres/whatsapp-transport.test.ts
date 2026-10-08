import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { PostgresDelivery } from "../../packages/messaging/src/postgres-delivery.js";
import { PostgresRecipientResolver } from "../../packages/messaging/src/whatsapp/recipient-resolver.js";
import { WhatsAppOutboundAdapter } from "../../packages/messaging/src/whatsapp/outbound-adapter.js";
import { FakeMessagingTransport, TransportError } from "../../packages/messaging/src/transport.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/index.js";
import { hashChallenge } from "../../packages/messaging/src/whatsapp/link-challenge.js";

let app: PostgresVerticalSliceApp;
let services: { recipients: PostgresRecipientResolver; delivery: PostgresDelivery; accountId: string };
vi.mock("../../apps/web/server/app.js", () => ({ productionApp: () => app }));
vi.mock("../../apps/web/server/whatsapp/transport.js", () => ({ whatsappTransport: () => services }));
import { GET, POST } from "../../apps/web/app/api/webhooks/whatsapp/route.js";
import { POST as signupRoute } from "../../apps/web/app/api/auth/signup/route.js";
import { PATCH as profileRoute } from "../../apps/web/app/api/profile/route.js";
import { POST as routineRoute } from "../../apps/web/app/api/routines/route.js";
import { POST as challengeRoute } from "../../apps/web/app/api/whatsapp/link-token/route.js";

const url = process.env.TEST_DATABASE_URL;
const pgDescribe = url || process.env.REQUIRE_POSTGRES_TESTS === "1" ? describe : describe.skip;
const secret = "phase-b-fixture-secret", accountId = "123456", address = "15551234567", key = "ab".repeat(32);
const inbound = new WhatsAppInboundAdapter(secret);
function raw(id: string, text: string, from = address) {
  return JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: accountId }, messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text } }] } }] }] });
}
function request(body: string) { return new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": inbound.sign(body) }, body }); }
pgDescribe("durable WhatsApp transport", () => {
  let owner: { userId: string; sessionToken: string }, other: typeof owner, scoped: string;
  let fake: FakeMessagingTransport;
  const servers: Server[] = [];
  const interpret = vi.fn();
  beforeEach(async () => {
    if (!url) throw new Error("TEST_DATABASE_URL required");
    const admin = new Pool({ connectionString: url }); await admin.query("drop schema if exists phase_b_transport_test cascade"); await admin.query("create schema phase_b_transport_test"); await admin.end();
    const parsed = new URL(url); parsed.searchParams.set("options", "-c search_path=phase_b_transport_test"); scoped = parsed.toString();
    interpret.mockReset(); app = new PostgresVerticalSliceApp({ connectionString: scoped, interpreter: { interpret } }); await app.migrate();
    owner = await app.signUp("transport-owner@example.com", "correct horse battery staple"); other = await app.signUp("transport-other@example.com", "correct horse battery staple");
    await app.configure(owner.sessionToken, c => c.profile({ preferredWeightUnit: "KG" }));
    await app.configure(owner.sessionToken, c => c.saveRoutine({ name: "Transport routine", sessions: [{ name: "Push", exercises: [{ exerciseIdentityId: "global_barbell_bench_press", plannedSetCount: 1, repTargetMin: 10 }] }] }));
    fake = new FakeMessagingTransport();
    services = { accountId, recipients: new PostgresRecipientResolver(app.pool, key, accountId), delivery: new PostgresDelivery(app.pool, fake) };
    vi.stubEnv("WHATSAPP_APP_SECRET", secret); vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "fixture-verify");
    vi.stubEnv("WHATSAPP_BUSINESS_NUMBER", "+15551234567");
    expect((await POST(request(raw("link", `link ${await app.createLinkToken(owner.userId, hashChallenge(address))}`)))).status).toBe(200);
  });
  afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } await app?.close(); vi.unstubAllEnvs(); });
  async function send(id: string, text: string) { const response = await POST(request(raw(id, text))); expect(response.status).toBe(200); return response.json(); }
  async function row(id: string) { return (await app.pool.query("select o.* from outbound_messages o join inbound_messages m on m.id=o.inbound_message_id where m.provider_message_id=$1", [id])).rows[0]; }
  async function started() { await send("start", "start"); await send("accept", "start planned"); }
  it("persists encrypted addressing and accepted provider evidence across restart, excluded from exports", async () => {
    const before = await row("link"); expect(before.status).toBe("SENT"); expect(before.provider_outbound_message_id).toBe(`fake-${before.id}`);
    expect((await app.pool.query("select address_ciphertext from whatsapp_recipient_addresses")).rows[0].address_ciphertext).not.toContain(address);
    await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scoped });
    services = { accountId, recipients: new PostgresRecipientResolver(app.pool, key, accountId), delivery: new PostgresDelivery(app.pool, fake) };
    expect(await services.recipients.resolve(before.recipient_identity_id)).toMatchObject({ address });
    expect(await row("link")).toEqual(before);
    await send("link", "replay does not consume again"); expect(fake.calls).toHaveLength(1);
    const exp = await app.requestExport(owner.sessionToken, { idempotencyKey: "transport-export" });
    const exported = JSON.stringify(await app.exportResult(owner.sessionToken, exp.id));
    expect(exported).not.toContain(address); expect(exported).not.toContain("address_ciphertext"); expect(exported).not.toContain(key);
  });
  it("duplicate and concurrent signed delivery produce one set, one logical response and one send", async () => {
    await started(); const before = fake.calls.length;
    await Promise.all(Array.from({ length: 4 }, () => send("set", "45x10")));
    expect((await app.pool.query("select id from workout_sets where user_id=$1", [owner.userId])).rows).toHaveLength(1);
    expect(fake.calls).toHaveLength(before + 1); expect((await app.pool.query("select * from outbound_delivery_attempts where outbound_message_id=$1", [(await row("set")).id])).rows).toHaveLength(1);
    expect(interpret).not.toHaveBeenCalled();
  });
  it("correction and destructive-confirmation replay send one response without applying twice", async () => {
    await started(); await send("two-sets", "45x10,45x9");
    const before = fake.calls.length;
    await Promise.all([send("correct-once", "actually that was 8"), send("correct-once", "actually that was 8")]);
    expect(fake.calls).toHaveLength(before + 1); expect((await app.pool.query("select id from corrections where type='CORRECT_SET'")).rows).toHaveLength(1);
    const proposal = await send("delete-old", "delete Barbell Bench Press set 1"); expect(proposal[0].body).toContain("Reply yes");
    const beforeConfirm = fake.calls.length;
    await Promise.all([send("confirm-once", "yes"), send("confirm-once", "yes")]);
    expect(fake.calls).toHaveLength(beforeConfirm + 1); expect((await app.pool.query("select id from corrections where type='DELETE_SET'")).rows).toHaveLength(1);
    expect((await app.pool.query("select reps from workout_sets where status='RECORDED'")).rows).toEqual([{ reps: 8 }]); expect(interpret).not.toHaveBeenCalled();
  });
  it("request-driven retry after an explicit rate-limit rejection is durable and bounded", async () => {
    await started(); fake.failure = new TransportError("RETRYABLE", "PROVIDER_RATE_LIMIT", true, 429);
    await send("retry", "45x10"); const failed = await row("retry"); expect(failed).toMatchObject({ status: "FAILED_RETRYABLE", attempt_count: 1, safe_to_retry: true });
    await send("retry", "45x10"); expect((await row("retry")).attempt_count).toBe(1);
    await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scoped }); services.delivery = new PostgresDelivery(app.pool, fake); services.recipients = new PostgresRecipientResolver(app.pool, key, accountId);
    await app.pool.query("update outbound_messages set next_attempt_at=now()-interval '1 second' where id=$1", [failed.id]); fake.failure = undefined;
    await send("retry", "45x10"); expect(await row("retry")).toMatchObject({ status: "SENT", attempt_count: 2 });
    expect((await app.pool.query("select id from workout_sets")).rows).toHaveLength(1);
  });
  it("ambiguous timeout never blindly retries and authenticated receipts reconcile it", async () => {
    await started(); fake.failure = new TransportError("UNKNOWN", "PROVIDER_CONNECTION_OR_TIMEOUT");
    await send("timeout", "45x10"); const failed = await row("timeout"); const count = fake.calls.length;
    expect(failed).toMatchObject({ status: "FAILED_FINAL", safe_to_retry: false, reconciliation_state: "DELIVERY_UNKNOWN" });
    await send("timeout", "45x10"); expect(fake.calls).toHaveLength(count);
    const receipt = (status: string, recipient = address) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: accountId }, statuses: [{ id: "wamid.timeout", status, timestamp: String(Math.floor(Date.now()/1000)), recipient_id: recipient, biz_opaque_callback_data: failed.id }] } }] }] });
    const invalid = await POST(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body: receipt("delivered"), headers: { "x-hub-signature-256": "bad" } })); expect(invalid.status).toBe(400); expect((await row("timeout")).status).toBe("FAILED_FINAL");
    await POST(request(receipt("delivered", "15559999999"))); expect((await row("timeout")).status).toBe("FAILED_FINAL");
    await POST(request(receipt("delivered"))); expect(await row("timeout")).toMatchObject({ status: "SENT", provider_outbound_message_id: "wamid.timeout", delivery_status: "delivered" });
    await POST(request(receipt("sent"))); expect((await row("timeout")).delivery_status).toBe("delivered"); expect(interpret).not.toHaveBeenCalled();
    await POST(request(receipt("failed"))); expect(await row("timeout")).toMatchObject({ delivery_status: "delivered", error_category: null });
  });
  it("stops after three explicit retryable attempts and never duplicates the command", async () => {
    await started(); fake.failure = new TransportError("RETRYABLE", "PROVIDER_RATE_LIMIT", true, 429);
    for (let attempt=1; attempt<=3; attempt++) {
      await send("bounded", "45x10"); const current = await row("bounded"); expect(current.attempt_count).toBe(attempt);
      await app.pool.query("update outbound_messages set next_attempt_at=now()-interval '1 second' where id=$1", [current.id]);
    }
    const count = fake.calls.length; await send("bounded", "45x10"); expect(fake.calls).toHaveLength(count);
    expect(await row("bounded")).toMatchObject({ status: "FAILED_FINAL", attempt_count: 3, safe_to_retry: false }); expect((await app.pool.query("select id from workout_sets")).rows).toHaveLength(1);
  });
  it("signed receipt during an in-flight HTTP timeout remains authoritative for acceptance", async () => {
    await started(); let release!: () => void, invoked!: () => void;
    const pending = new Promise<void>(resolve => { release=resolve; }), called = new Promise<void>(resolve => { invoked=resolve; });
    const sendMessage = vi.fn(async () => { invoked(); await pending; throw new TransportError("UNKNOWN", "PROVIDER_CONNECTION_OR_TIMEOUT"); });
    services.delivery = new PostgresDelivery(app.pool, { sendMessage });
    const processing = send("receipt-race", "45x10"); await called; const current = await row("receipt-race");
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: accountId }, statuses: [{ id: "wamid.receipt-race", status: "delivered", timestamp: String(Math.floor(Date.now()/1000)), recipient_id: address, biz_opaque_callback_data: current.id }] } }] }] });
    expect((await POST(request(body))).status).toBe(200); release(); await processing;
    expect(await row("receipt-race")).toMatchObject({ status: "SENT", safe_to_retry: false, provider_outbound_message_id: "wamid.receipt-race", delivery_status: "delivered" });
    expect((await app.pool.query("select outcome from outbound_delivery_attempts where outbound_message_id=$1", [current.id])).rows).toEqual([{ outcome: "ACCEPTED" }]);
    await send("receipt-race", "45x10"); expect(sendMessage).toHaveBeenCalledTimes(1);
  });
  it("recovers command-committed response-pending restart and concurrent send reservation", async () => {
    await started(); const body = raw("commit", "45x10"), message = inbound.normalize(body, inbound.sign(body))[0]!;
    await app.processInbound(message, { crashAfterCommandBeforeOutbound: true }); await app.close();
    app = new PostgresVerticalSliceApp({ connectionString: scoped }); services.recipients = new PostgresRecipientResolver(app.pool, key, accountId);
    let release!: () => void, invoked!: () => void;
    const pending = new Promise<void>(resolve => { release=resolve; }), called = new Promise<void>(resolve => { invoked=resolve; });
    const sendMessage = vi.fn(async () => { invoked(); await pending; return { providerMessageId: "wamid.concurrent" }; });
    services.delivery = new PostgresDelivery(app.pool, { sendMessage });
    const first = send("commit", "45x10"); await called;
    const current = await row("commit"); expect(current.status).toBe("SENDING");
    expect(await services.delivery.deliver(current.id)).toBe("BUSY");
    release(); await first;
    expect(sendMessage).toHaveBeenCalledTimes(1); expect((await row("commit")).status).toBe("SENT"); expect((await app.pool.query("select id from workout_sets")).rows).toHaveLength(1);
  });
  it("permanent rejection and missing recipient preserve unsent records", async () => {
    await started(); fake.failure = new TransportError("PERMANENT", "PROVIDER_REJECTED", false, 400);
    await send("reject", "45x10"); expect(await row("reject")).toMatchObject({ status: "FAILED_FINAL", safe_to_retry: false, sent_at: null });
    await app.pool.query("delete from whatsapp_recipient_addresses");
    const real = new WhatsAppOutboundAdapter({ accessToken: "test", phoneNumberId: accountId, apiVersion: "v25.0", resolver: services.recipients, fetch: vi.fn() });
    const delivery = new PostgresDelivery(app.pool, real);
    const missing = raw("missing", "45x9");
    const message = inbound.normalize(missing, inbound.sign(missing))[0]!;
    await app.processInbound(message); const pending = await row("missing"); expect(await delivery.deliver(pending.id)).toBe("INVALID_RECIPIENT"); expect((await row("missing")).status).toBe("FAILED_RETRYABLE");
  });
  it("interrupted attempts remain unknown after restart and cannot reapply mutation", async () => {
    await started(); const body = raw("crash", "45x10"), message = inbound.normalize(body, inbound.sign(body))[0]!;
    await app.processInbound(message, { crashAfterCommandBeforeOutbound: true }); await app.processInbound(message);
    const pending = await row("crash");
    await app.pool.query("update outbound_messages set status='SENDING',attempt_count=1,attempt_started_at=now()-interval '2 minutes' where id=$1", [pending.id]);
    await app.pool.query("insert into outbound_delivery_attempts(outbound_message_id,attempt_number,outcome) values($1,1,'SENDING')", [pending.id]);
    await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scoped }); services.delivery = new PostgresDelivery(app.pool, fake);
    const before = fake.calls.length; expect(await services.delivery.deliver(pending.id)).toBe("DELIVERY_UNKNOWN");
    expect(await row("crash")).toMatchObject({ status: "FAILED_FINAL", reconciliation_state: "DELIVERY_UNKNOWN", safe_to_retry: false }); expect(fake.calls).toHaveLength(before);
    expect((await app.pool.query("select id from workout_sets")).rows).toHaveLength(1);
  });
  it("deleted users, revoked/foreign links and changed data generations cannot send", async () => {
    await started(); const body = raw("owned", "45x10"), message = inbound.normalize(body, inbound.sign(body))[0]!; await app.processInbound(message);
    const pending = await row("owned");
    await expect(app.pool.query("update whatsapp_identity_links set user_id=$1 where user_id=$2", [other.userId, owner.userId])).rejects.toMatchObject({ code: "23503" });
    // A legacy foreign link can exist after the original is revoked; old responses must not follow it.
    await app.pool.query("update whatsapp_identity_links set status='REVOKED',revoked_at=now() where user_id=$1", [owner.userId]);
    await app.pool.query("insert into whatsapp_identity_links(id,user_id,whatsapp_provider_user_identity_id,linked_at,verified_at) select 'foreign-fixture',$1,whatsapp_provider_user_identity_id,now(),now() from whatsapp_identity_links where user_id=$2", [other.userId, owner.userId]);
    expect(await services.delivery.deliver(pending.id)).toBe("BLOCKED");
    await app.pool.query("delete from whatsapp_identity_links where id='foreign-fixture'");
    await app.pool.query("update whatsapp_identity_links set status='VERIFIED',revoked_at=null where user_id=$1", [owner.userId]);
    await app.pool.query("update users set data_control_generation=data_control_generation+1 where id=$1", [owner.userId]); expect(await services.delivery.deliver(pending.id)).toBe("BLOCKED");
    await app.pool.query("update users set deleted_at=now() where id=$1", [owner.userId]); expect(await services.delivery.deliver(pending.id)).toBe("BLOCKED");
    await expect(services.recipients.resolve((await row("link")).recipient_identity_id)).rejects.toMatchObject({ code: "RECIPIENT_UNAVAILABLE" });
  });
  it("invalid signatures and invalid accounts cannot mutate or invoke AI", async () => {
    const before = (await app.pool.query("select count(*)::int n from inbound_messages")).rows[0].n;
    const response = await POST(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body: raw("invalid", "45x10"), headers: { "x-hub-signature-256": "sha256=bad" } })); expect(response.status).toBe(400);
    const wrong = raw("wrong-account", "start").replace(accountId, "9999"); expect((await POST(request(wrong))).status).toBe(400);
    const unlinked = raw("unlinked", "start", "15559999999"); expect((await POST(request(unlinked))).status).toBe(400);
    expect((await app.pool.query("select count(*)::int n from inbound_messages")).rows[0].n).toBe(before); expect(interpret).not.toHaveBeenCalled();
  });
  it("all migrations apply fresh and upgrade quarantines legacy false SENT and old pending without replay", async () => {
    const admin = new Pool({ connectionString: url }); await admin.query("drop schema if exists phase_b_upgrade_test cascade"); await admin.query("create schema phase_b_upgrade_test"); await admin.end();
    const parsed = new URL(url!); parsed.searchParams.set("options", "-c search_path=phase_b_upgrade_test"); const upgrade = new PostgresVerticalSliceApp({ connectionString: parsed.toString() });
    try {
      await upgrade.pool.query("create table schema_migrations(name text primary key)");
      for (const file of ["0001_vertical_slice.sql", "0002_us4.sql", "0003_us5.sql", "0004_us6.sql", "0005_us7.sql", "0006_release_integrity.sql", "0007_core_configuration.sql"]) { await upgrade.pool.query(await readFile(`packages/persistence/migrations/${file}`, "utf8")); await upgrade.pool.query("insert into schema_migrations(name) values($1)", [file]); }
      const user = await upgrade.signUp("legacy@example.com", "correct horse battery staple");
      // Seed genuine historical rows using the pre-upgrade schema, not the current linking API.
      await upgrade.pool.query("insert into whatsapp_provider_accounts(id,provider,provider_account_id) values('legacy-a','WHATSAPP_CLOUD_API',$1)", [accountId]);
      await upgrade.pool.query("insert into whatsapp_provider_user_identities(id,whatsapp_provider_account_id,provider_user_identity_hash) values('legacy-i','legacy-a',$1)", [hashChallenge(address)]);
      await upgrade.pool.query("insert into whatsapp_identity_links(id,user_id,whatsapp_provider_user_identity_id,linked_at) values('legacy-l',$1,'legacy-i',now())", [user.userId]);
      const body = raw("legacy", "start");
      await upgrade.pool.query("insert into inbound_messages(id,provider,provider_account_id,provider_message_id,provider_user_identity_hash,user_id,raw_payload_hash,processing_status,result_body) values('legacy-in','WHATSAPP_CLOUD_API',$1,'legacy',$2,$3,$4,'COMPLETED','legacy')", [accountId, hashChallenge(address), user.userId, hashChallenge(body)]);
      await upgrade.pool.query("insert into outbound_messages(id,user_id,inbound_message_id,provider_account_id,provider_user_identity_hash,body_hash,body,status) values('legacy-out',$1,'legacy-in',$2,$3,$4,'legacy','PENDING')", [user.userId, accountId, hashChallenge(address), hashChallenge("legacy")]);
      await upgrade.pool.query("update outbound_messages set status='SENT',sent_at=now()");
      await upgrade.pool.query("insert into inbound_messages(id,provider,provider_account_id,provider_message_id,provider_user_identity_hash,user_id,raw_payload_hash,processing_status,result_body) values('legacy-in2','WHATSAPP_CLOUD_API',$1,'old-pending',$2,$3,$4,'COMPLETED','legacy')", [accountId, hashChallenge(address), user.userId, hashChallenge("old-pending")]);
      await upgrade.pool.query("insert into outbound_messages(id,user_id,inbound_message_id,provider_account_id,provider_user_identity_hash,body_hash,body,status) values('legacy-out2',$1,'legacy-in2',$2,$3,$4,'legacy','PENDING')", [user.userId, accountId, hashChallenge(address), hashChallenge("legacy")]);
      await upgrade.migrate(); await upgrade.migrate(); const rows = (await upgrade.pool.query("select status,safe_to_retry,reconciliation_state,sent_at from outbound_messages order by reconciliation_state")).rows;
      expect(rows).toEqual([{ status: "PENDING", safe_to_retry: false, reconciliation_state: "LEGACY_NEVER_ATTEMPTED", sent_at: null }, { status: "FAILED_FINAL", safe_to_retry: false, reconciliation_state: "LEGACY_UNKNOWN", sent_at: null }]);
      const transport = new FakeMessagingTransport(), delivery = new PostgresDelivery(upgrade.pool, transport);
      for (const row of (await upgrade.pool.query("select id from outbound_messages")).rows) expect(await delivery.deliver(row.id)).toBe("NOT_RETRYABLE"); expect(transport.calls).toHaveLength(0);
      await expect(upgrade.pool.query("update outbound_messages set status='SENT'")).rejects.toMatchObject({ code: "23514" });
    } finally { await upgrade.close(); }
  });
  it("controlled HTTP provider receives exactly one addressed reply for signed webhook mutation and replay", async () => {
    const received: Array<{ to: string; text: { body: string }; biz_opaque_callback_data: string }> = [];
    let rateLimit = false;
    const provider = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      expect(req.url).toBe(`/v25.0/${accountId}/messages`); expect(req.headers.authorization).toBe("Bearer fixture-access-token");
      received.push(JSON.parse(body));
      res.writeHead(rateLimit ? 429 : 200, { "content-type": "application/json" }); res.end(JSON.stringify(rateLimit ? { error: { code: 130429 } } : { messages: [{ id: `wamid.http-${received.length}` }] }));
    }); provider.listen(0, "127.0.0.1"); await once(provider, "listening"); servers.push(provider);
    const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
    services.delivery = new PostgresDelivery(app.pool, new WhatsAppOutboundAdapter({ accessToken: "fixture-access-token", phoneNumberId: accountId, apiVersion: "v25.0", resolver: services.recipients, testOrigin: origin }));
    const application = createServer(async (req, res) => {
      try {
        let body = ""; for await (const chunk of req) body += chunk;
        const url = `http://localhost${req.url}`;
        const request = new Request(url, { method: req.method ?? "POST", ...(req.method === "GET" ? {} : { body }), headers: { cookie: String(req.headers.cookie ?? ""), "content-type": "application/json", "x-hub-signature-256": String(req.headers["x-hub-signature-256"] ?? "") } });
        const path = new URL(url).pathname;
        const result = req.method === "GET" ? await GET(request) : path === "/api/auth/signup" ? await signupRoute(request) : path === "/api/profile" ? await profileRoute(request) : path === "/api/routines" ? await routineRoute(request) : path === "/api/whatsapp/link-token" ? await challengeRoute(request) : await POST(request);
        res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(await result.text());
      } catch { res.writeHead(500); res.end(); }
    }); application.listen(0, "127.0.0.1"); await once(application, "listening"); servers.push(application);
    const appOrigin = `http://127.0.0.1:${(application.address() as AddressInfo).port}`;
    expect(await (await fetch(`${appOrigin}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=fixture-verify&hub.challenge=42`)).text()).toBe("42");
    const httpAddress = "15557654321";
    const signup = await fetch(`${appOrigin}/api/auth/signup`, { method: "POST", body: JSON.stringify({ email: "http-acceptance@example.com", password: "correct horse battery staple" }) }); expect(signup.status).toBe(200);
    const auth = await signup.json(), cookie = signup.headers.get("set-cookie")!.split(";")[0]!; other = { userId: auth.userId, sessionToken: cookie.split("=")[1]! };
    const api = async (path: string, method: string, input: unknown) => { const response = await fetch(`${appOrigin}${path}`, { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(input) }); expect(response.status).toBe(200); return response.json(); };
    await api("/api/profile", "PATCH", { preferredWeightUnit: "KG" });
    await api("/api/routines", "POST", { name: "HTTP routine", sessions: [{ name: "Push", exercises: [{ exerciseIdentityId: "global_barbell_bench_press", plannedSetCount: 1, repTargetMin: 10 }] }] });
    const proof = await api("/api/whatsapp/link-token", "POST", { phoneNumber: `+${httpAddress}`, consent: true });
    const webhook = async (id: string, text: string) => { const body = raw(id, text, httpAddress); const result = await fetch(`${appOrigin}/api/webhooks/whatsapp`, { method: "POST", headers: { "x-hub-signature-256": inbound.sign(body) }, body }); expect(result.status).toBe(200); };
    await webhook("http-link", `LINK ${proof.token}`); await webhook("http-link", `LINK ${proof.token}`);
    expect(received.filter(item => item.text.body.startsWith("WhatsApp connected successfully"))).toHaveLength(1);
    expect(received.filter(item => item.text.body.startsWith("Your workout plan HTTP routine"))).toHaveLength(1);
    expect(received.at(-1)!.to).toBe(httpAddress);
    await webhook("http-start", "start"); await webhook("http-accept", "start planned"); const before = received.length;
    await Promise.all([webhook("http-set", "45x10"), webhook("http-set", "45x10")]);
    const persisted = await row("http-set");
    expect(received).toHaveLength(before + 1); expect(received.at(-1)).toMatchObject({ to: httpAddress, biz_opaque_callback_data: persisted.id });
    expect(received.at(-1)!.text.body).toBe(persisted.body); expect(persisted.body).toContain("45 kg"); expect(persisted.body).toContain("x 10");
    expect((await app.pool.query("select load_value,weight_unit,load_semantics,reps from workout_sets where user_id=$1", [other.userId])).rows).toEqual([{ load_value: "45", weight_unit: "KG", load_semantics: "TOTAL_LOAD", reps: 10 }]); expect(interpret).not.toHaveBeenCalled();
    rateLimit = true; await webhook("http-retry", "45x9"); const pending = await row("http-retry"); expect(pending.status).toBe("FAILED_RETRYABLE");
    rateLimit = false; await app.pool.query("update outbound_messages set next_attempt_at=now()-interval '1 second' where id=$1", [pending.id]); await webhook("http-retry", "45x9");
    expect(await row("http-retry")).toMatchObject({ status: "SENT", attempt_count: 2 }); expect(received.at(-1)!.biz_opaque_callback_data).toBe(pending.id);
    const accepted = received.length; await webhook("http-retry", "45x9"); expect(received).toHaveLength(accepted);
    await webhook("http-finish", "done"); expect(received.at(-1)!.text.body).toBe((await row("http-finish")).body);
    const history = await app.history(other.userId); expect(history).toHaveLength(1); expect(history[0]!.workout.status).toBe("COMPLETED"); expect(history[0]!.sets.map(set => set.reps)).toEqual([10,9]);
    expect(interpret).not.toHaveBeenCalled();
  });
});
