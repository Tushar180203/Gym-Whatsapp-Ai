import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { queueWorkoutReminders } from "../../packages/persistence/src/workout-reminders.js";
import { PostgresDelivery } from "../../packages/messaging/src/postgres-delivery.js";
import { FakeMessagingTransport, TransportError } from "../../packages/messaging/src/transport.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/whatsapp/inbound-adapter.js";
import { PostgresRecipientResolver } from "../../packages/messaging/src/whatsapp/recipient-resolver.js";
import { renderMorningReminder } from "../../packages/domain/src/reminders/morning-reminder.js";
const url = process.env.TEST_DATABASE_URL;
const pgDescribe = url || process.env.REQUIRE_POSTGRES_TESTS === "1" ? describe : describe.skip;
const now = new Date("2026-10-25T23:30:00Z"), accountId = "123456", address = "15555550123";
pgDescribe("morning workout reminder persistence", () => {
  let app: PostgresVerticalSliceApp, owner: { userId: string; sessionToken: string }, scopedUrl: string, fake: FakeMessagingTransport;
  beforeEach(async () => {
    if (!url) throw new Error("A disposable TEST_DATABASE_URL is required");
    const admin = new Pool({ connectionString: url });
    await admin.query("drop schema if exists workout_reminders_test cascade"); await admin.query("create schema workout_reminders_test"); await admin.end();
    const scoped = new URL(url); scoped.searchParams.set("options", "-c search_path=workout_reminders_test");
    scopedUrl = scoped.toString(); app = new PostgresVerticalSliceApp({ connectionString: scopedUrl }); await app.migrate();
    owner = await app.signUp("reminders@example.com", "correct horse battery staple");
    await app.configure(owner.sessionToken, c => c.profile({ preferredWeightUnit: "KG", timeZone: "Asia/Kolkata", workoutRemindersEnabled: true }));
    await app.configure(owner.sessionToken, c => c.saveRoutine({ name: "My plan", schedule: { plannedDays: ["MON", "WED", "FRI"] }, sessions: [{ name: "Push day", exercises: [{ exerciseIdentityId: "global_barbell_bench_press", plannedSetCount: 3, repTargetMin: 8 }] }] }));
    const proof = await app.createWebLinkToken(owner.sessionToken, { phoneNumber: `+${address}`, consent: true });
    const inbound = new WhatsAppInboundAdapter("fixture-secret");
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: accountId }, messages: [{ id: "link", from: address, text: { body: `LINK ${proof.token}` } }] } }] }] });
    const recipients = new PostgresRecipientResolver(app.pool, "ab".repeat(32), accountId);
    await app.processInbound(inbound.normalize(raw, inbound.sign(raw))[0]!, { writeVerifiedRecipient: (db, identityId) => recipients.remember({ accountId, identityHash: inbound.normalize(raw, inbound.sign(raw))[0]!.providerUserIdentityHash, address, timestamp: new Date() }, db, identityId) });
    await app.pool.query("update whatsapp_recipient_addresses set last_inbound_at=$1", [new Date(now.getTime() - 3600000)]);
    fake = new FakeMessagingTransport();
  });
  afterEach(async () => { await app?.close(); });
  const reminder = async () => (await app.pool.query("select * from outbound_messages where notification_key like 'workout-reminder:%'")).rows[0];
  const queue = (dryRun = false, at = now) => queueWorkoutReminders(app.pool, { accountId }, at, dryRun);
  it("persists preference, supports a read-only preview and exports the preference", async () => {
    expect((await app.profile(owner.userId)).workoutRemindersEnabled).toBe(true);
    expect(await queue(true)).toEqual({ eligible: 1, queued: 0, closedWindow: 0 }); expect(await reminder()).toBeUndefined();
    const exported = await app.requestExport(owner.sessionToken, { idempotencyKey: "reminder-export" });
    expect(JSON.stringify(await app.exportResult(owner.sessionToken, exported.id))).toContain('"workout_reminders_enabled":true');
    await app.configure(owner.sessionToken, c => c.profile({ preferredWeightUnit: "KG" }));
    expect((await app.profile(owner.userId)).workoutRemindersEnabled).toBe(true);
  });
  it("deduplicates concurrent ticks and restarts without creating workouts or advancing a cursor", async () => {
    const before = (await app.pool.query("select * from routine_sequence_cursors")).rows;
    const results = await Promise.all([queue(), queue(), queue()]);
    expect(results.reduce((sum, row) => sum + row.queued, 0)).toBe(1);
    expect((await app.pool.query("select id from workout_sessions")).rows).toEqual([]);
    expect((await app.pool.query("select * from routine_sequence_cursors")).rows).toEqual(before);
    const row = await reminder(); expect(row.body).toBe(renderMorningReminder("My plan: Push day")); expect(row.message_template).toBeNull();
    expect(row.notification_key).toBe(`workout-reminder:${owner.userId}:2026-10-26`);
    await app.close(); app = new PostgresVerticalSliceApp({ connectionString: scopedUrl });
    expect(await queue()).toMatchObject({ queued: 0 });
    const delivery = new PostgresDelivery(app.pool, fake, undefined, () => now);
    expect(await delivery.deliver(row.id)).toBe("SENT"); expect(await delivery.deliver(row.id)).toBe("SENT");
    expect(fake.calls).toHaveLength(1); expect(fake.calls[0]!.body).toBe(row.body); expect(fake.calls[0]!.template).toBeUndefined();
  });
  it("pauses without an approved template after 24 hours of inactivity", async () => {
    await app.pool.query("update whatsapp_recipient_addresses set last_inbound_at=$1", [new Date(now.getTime() - 86400000)]);
    expect(await queue()).toEqual({ eligible: 0, queued: 0, closedWindow: 1 }); expect(await reminder()).toBeUndefined();
    await app.pool.query("update whatsapp_recipient_addresses set last_inbound_at=$1", [now]);
    expect(await queue()).toMatchObject({ queued: 1 });
  });
  it("can use an optional approved template with a closed chat window", async () => {
    await app.pool.query("update whatsapp_recipient_addresses set last_inbound_at=$1", [new Date(0)]);
    expect(await queueWorkoutReminders(app.pool, { accountId, template: { name: "workout_reminder_5am", languageCode: "en" } }, now, false)).toMatchObject({ queued: 1 });
    const row = await reminder(); expect(row.message_template).toEqual({ name: "workout_reminder_5am", languageCode: "en", bodyParameters: ["My plan: Push day"] });
    await new PostgresDelivery(app.pool, fake, undefined, () => now).deliver(row.id);
    expect(fake.calls[0]!.template).toEqual(row.message_template);
  });
  it.each(["disabled", "expired", "revoked", "generation", "active", "deleted", "consent"])("blocks a queued reminder after %s", async state => {
    await queue(); const row = await reminder();
    if (state === "disabled") await app.configure(owner.sessionToken, c => c.profile({ preferredWeightUnit: "KG", workoutRemindersEnabled: false }));
    if (state === "revoked") await app.pool.query("update whatsapp_identity_links set status='REVOKED',revoked_at=clock_timestamp() where user_id=$1", [owner.userId]);
    if (state === "active") await app.startNextWorkout(owner.userId);
    if (state === "consent") await app.pool.query("update whatsapp_identity_links set opt_in_at=null where user_id=$1", [owner.userId]);
    if (state === "deleted") await app.pool.query("update users set deleted_at=clock_timestamp() where id=$1", [owner.userId]);
    if (state === "generation") await app.pool.query("update users set data_control_generation=data_control_generation+1 where id=$1", [owner.userId]);
    const delivery = new PostgresDelivery(app.pool, fake, undefined, () => state === "expired" ? new Date("2026-10-25T23:45:00Z") : now);
    expect(await delivery.deliver(row.id)).toBe("BLOCKED"); expect(fake.calls).toHaveLength(0);
  });
  it("does not queue on off days or before 5 AM, and skips an active workout", async () => {
    expect(await queue(false, new Date("2026-10-25T23:29:59Z"))).toMatchObject({ queued: 0 });
    expect(await queue(false, new Date("2026-10-26T23:30:00Z"))).toMatchObject({ queued: 0 });
    await app.startNextWorkout(owner.userId);
    expect(await queue()).toMatchObject({ queued: 0 });
  });
  it("skips completed early training and recipients without messaging consent", async () => {
    await app.startNextWorkout(owner.userId); const workout = (await app.activeWorkout(owner.userId))!;
    await app.recordWebSets(owner.sessionToken, workout.id, { notation: "45kg x 8", expectedVersion: workout.version, idempotencyKey: "early-training" });
    await app.pool.query("update workout_sessions set status='COMPLETED',completed_at=$2,started_at=$2,active_session_exercise_id=null where id=$1", [workout.id, new Date(now.getTime() - 30 * 60000)]);
    expect(await queue()).toMatchObject({ queued: 0 });
    await app.pool.query("update whatsapp_identity_links set opt_in_at=null where user_id=$1", [owner.userId]);
    expect(await queue()).toMatchObject({ queued: 0 });
  });
  it("retains one logical reminder across explicit retryable delivery failure", async () => {
    await queue(); const row = await reminder(), delivery = new PostgresDelivery(app.pool, fake, undefined, () => now);
    fake.failure = new TransportError("RETRYABLE", "FIXTURE_RATE_LIMIT", true, 429);
    expect(await delivery.deliver(row.id)).toBe("RETRYABLE");
    fake.failure = undefined; await app.pool.query("update outbound_messages set next_attempt_at=clock_timestamp()-interval '1 second' where id=$1", [row.id]);
    expect(await delivery.deliver(row.id)).toBe("SENT"); expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]!.idempotencyKey).toBe(fake.calls[1]!.idempotencyKey);
    expect((await app.pool.query("select id from outbound_messages where notification_key like 'workout-reminder:%'")).rows).toHaveLength(1);
  });
});
