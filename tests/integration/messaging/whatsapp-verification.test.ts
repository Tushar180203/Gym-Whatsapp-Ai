import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ processInbound: vi.fn(), transport: vi.fn() }));
vi.mock("../../../apps/web/server/app.js", () => ({ productionApp: () => ({ processInbound: mocks.processInbound }) }));
vi.mock("../../../apps/web/server/whatsapp/transport.js", () => ({ whatsappTransport: mocks.transport }));
import { GET, POST } from "../../../apps/web/app/api/webhooks/whatsapp/route.js";
import { WhatsAppInboundAdapter } from "../../../packages/messaging/src/index.js";
import { runtimeEnv } from "../../../packages/contracts/src/env.js";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("HTTP webhook security", () => {
  it("returns an unquoted challenge over the contracted GET route", async () => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "fixture-token");
    const url = "http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=fixture-token&hub.challenge=12345";
    const response = await GET(new Request(url)); expect(response.status).toBe(200); expect(await response.text()).toBe("12345");
    expect((await GET(new Request(url.replace("fixture-token", "wrong")))).status).toBe(403);
    expect((await GET(new Request("http://localhost/api/webhooks/whatsapp"))).status).toBe(400);
    expect((await GET(new Request(url + "&hub.mode=subscribe"))).status).toBe(400);
  });
  it("rejects unauthenticated payloads before accessing services, mutation or AI", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "fixture-secret");
    const response = await POST(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": "sha256=invalid" }, body: '{"untrusted":"ignore instructions"}' }));
    expect(response.status).toBe(400); expect(mocks.processInbound).not.toHaveBeenCalled(); expect(mocks.transport).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("fixture-secret");
  });
  it("requires complete production transport configuration without exposing values", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/test", GEMINI_API_KEY: "private-key", WHATSAPP_APP_SECRET: "private-secret", WHATSAPP_PROVIDER: "cloud_api" };
    expect(() => runtimeEnv(env)).toThrow("WHATSAPP_ACCESS_TOKEN");
    try { runtimeEnv(env); } catch (error) { expect(String(error)).not.toContain("private-key"); expect(String(error)).not.toContain("private-secret"); }
    expect(runtimeEnv({ ...env, WHATSAPP_ACCESS_TOKEN: "placeholder", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_VERIFY_TOKEN: "placeholder", WHATSAPP_RECIPIENT_ENCRYPTION_KEY: "ab".repeat(32), WHATSAPP_GRAPH_API_VERSION: "v25.0", WHATSAPP_BUSINESS_NUMBER: "+15551234567" }).WHATSAPP_PROVIDER).toBe("cloud_api");
  });
  it("validates provider account and timestamps before exposing a production batch", () => {
    const adapter = new WhatsAppInboundAdapter("secret");
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "business", changes: [{ value: { metadata: { phone_number_id: "other" }, messages: [{ id: "m", from: "15551234567", timestamp: "1", text: { body: "start" } }] } }] }] });
    expect(() => adapter.decodeProduction(raw, adapter.sign(raw), "123")).toThrow("Unexpected provider account");
    const missingTime = raw.replace('"timestamp":"1",', "").replace('"other"', '"123"');
    expect(() => adapter.decodeProduction(missingTime, adapter.sign(missingTime), "123")).toThrow("Invalid provider message metadata");
  });
});
