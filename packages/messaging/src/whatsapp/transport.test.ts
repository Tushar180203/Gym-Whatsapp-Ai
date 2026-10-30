import { describe, expect, it, vi } from "vitest";
import { RecipientCipher } from "./recipient-resolver.js";
import { verifyChallenge } from "./verification.js";
import { WhatsAppOutboundAdapter, providerFailure } from "./outbound-adapter.js";
import { safeEvent } from "../../../domain/src/observability/events.js";

describe("WhatsApp provider boundary", () => {
  it("encrypts addressing, authenticates ciphertext and binds it to the identity", () => {
    const cipher = new RecipientCipher("ab".repeat(32)); const value = cipher.encrypt("15551234567", "identity");
    expect(value).not.toContain("15551234567"); expect(cipher.decrypt(value, "identity")).toBe("15551234567");
    expect(() => cipher.decrypt(value, "other")).toThrow(); expect(() => new RecipientCipher("cd".repeat(32)).decrypt(value, "identity")).toThrow();
  });
  it("verifies the exact GET challenge and rejects malformed, duplicate and incorrect credentials", async () => {
    const url = "https://app.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=secret&hub.challenge=123";
    expect(await verifyChallenge(url, "secret").text()).toBe("123");
    expect(verifyChallenge(url, "other").status).toBe(403);
    expect(verifyChallenge(url + "&hub.challenge=456", "secret").status).toBe(400);
    expect(verifyChallenge(url.replace("123", "<script>"), "secret").status).toBe(400);
    expect(verifyChallenge("https://app.test", "secret").status).toBe(400);
    expect(verifyChallenge(url, undefined).status).toBe(503);
  });
  const resolver = { resolve: async () => ({ address: "15551234567", lastInboundAt: new Date() }) };
  const input = { recipientIdentityId: "internal-id", body: "Recorded 45 kg x 10", idempotencyKey: "logical-outbound" };
  it("resolves addressing inside the adapter and preserves logical correlation", async () => {
    const send = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid.1" }] }));
    const adapter = new WhatsAppOutboundAdapter({ accessToken: "test-secret", phoneNumberId: "123", apiVersion: "v25.0", resolver, fetch: send });
    expect(await adapter.sendMessage(input)).toEqual({ providerMessageId: "wamid.1" });
    const body = JSON.parse(send.mock.calls[0]![1].body);
    expect(body.to).toBe("15551234567"); expect(body.to).not.toBe(input.recipientIdentityId);
    expect(body.biz_opaque_callback_data).toBe(input.idempotencyKey);
  });
  it.each([400, 401, 403, 429, 500, 503])("normalizes HTTP %i without disclosing provider payloads", async status => {
    const adapter = new WhatsAppOutboundAdapter({ accessToken: "test-secret", phoneNumberId: "123", apiVersion: "v25.0", resolver, fetch: vi.fn().mockResolvedValue(new Response("private payload", { status })) });
    await expect(adapter.sendMessage(input)).rejects.toMatchObject({ category: providerFailure(status).category, safeToRetry: status === 429 });
  });
  it("does not retry ambiguous connection failures or malformed success", async () => {
    for (const send of [vi.fn().mockRejectedValue(new Error("secret socket payload")), vi.fn().mockResolvedValue(Response.json({ messages: [] }))]) {
      const adapter = new WhatsAppOutboundAdapter({ accessToken: "test", phoneNumberId: "123", apiVersion: "v25.0", resolver, fetch: send });
      await expect(adapter.sendMessage(input)).rejects.toMatchObject({ category: "UNKNOWN", safeToRetry: false });
    }
  });
  it("enforces the conversational window without an API call", async () => {
    const send = vi.fn();
    const adapter = new WhatsAppOutboundAdapter({ accessToken: "test", phoneNumberId: "123", apiVersion: "v25.0", resolver: { resolve: async () => ({ address: "15551234567", lastInboundAt: new Date(0) }) }, fetch: send });
    await expect(adapter.sendMessage(input)).rejects.toMatchObject({ code: "SERVICE_WINDOW_CLOSED" }); expect(send).not.toHaveBeenCalled();
  });
  it("logs internal identifiers/status only, dropping addresses, payloads and credentials", () => {
    const event = safeEvent({ event: "outbound_failure", outboundId: `outbound_${"a".repeat(24)}`, recipientIdentityId: "15551234567", status: "FAILED_FINAL", code: "PROVIDER_AUTH", authorization: "Bearer secret", body: "private workout", address: "15551234567" } as any);
    expect(event).toEqual({ event: "outbound_failure", outboundId: `outbound_${"a".repeat(24)}`, status: "FAILED_FINAL", code: "PROVIDER_AUTH" });
  });
  it("normalizes an actual abort deadline as delivery unknown", async () => {
    const send: typeof fetch = (_url, options) => new Promise((_resolve, reject) => { options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason)); });
    const adapter = new WhatsAppOutboundAdapter({ accessToken: "test", phoneNumberId: "123", apiVersion: "v25.0", resolver, fetch: send, timeoutMs: 5 });
    await expect(adapter.sendMessage(input)).rejects.toMatchObject({ category: "UNKNOWN", safeToRetry: false });
  });
});

describe("approved reminder templates", () => {
  const resolver = { resolve: async () => ({ address: "15555550123", lastInboundAt: new Date(0) }) };
  it("sends the persisted approved envelope outside the reply window without reopening it", async () => {
    const send = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid.template" }] }));
    const adapter = new WhatsAppOutboundAdapter({ accessToken: "fixture", phoneNumberId: "123", apiVersion: "v25.0", resolver, fetch: send });
    const input = { recipientIdentityId: "identity", body: "Reminder text", idempotencyKey: "reminder-1", template: { name: "workout_reminder_5am", languageCode: "en", bodyParameters: ["Push: Bench day"] } };
    await expect(adapter.sendMessage(input)).resolves.toEqual({ providerMessageId: "wamid.template" });
    expect(JSON.parse(send.mock.calls[0]![1].body)).toMatchObject({ type: "template", template: { name: "workout_reminder_5am", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Push: Bench day" }] }] }, biz_opaque_callback_data: "reminder-1" });
    expect(JSON.parse(send.mock.calls[0]![1].body).text).toBeUndefined();
    await expect(adapter.sendMessage({ recipientIdentityId: "identity", body: "A free-form message", idempotencyKey: "free-form" })).rejects.toMatchObject({ code: "SERVICE_WINDOW_CLOSED" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed or multiline template parameters before calling the provider", async () => {
    const send = vi.fn();
    const adapter = new WhatsAppOutboundAdapter({ accessToken: "fixture", phoneNumberId: "123", apiVersion: "v25.0", resolver, fetch: send });
    await expect(adapter.sendMessage({ recipientIdentityId: "identity", body: "Reminder", idempotencyKey: "invalid", template: { name: "wrong/name", languageCode: "en", bodyParameters: ["a\nb"] } })).rejects.toMatchObject({ code: "MESSAGE_TEMPLATE_INVALID" });
    expect(send).not.toHaveBeenCalled();
  });
});
