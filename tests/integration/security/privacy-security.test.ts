import { describe, expect, it, vi } from "vitest";
import { RateLimitService } from "../../../packages/domain/src/rate-limit/rate-limit-service.js";
import { safeEvent } from "../../../packages/domain/src/observability/events.js";
import { runtimeEnv } from "../../../packages/contracts/src/env.js";
import { apiResponse, boundedWebhookBody, failureCode } from "../../../apps/web/server/http.js";
import { WhatsAppInboundAdapter } from "../../../packages/messaging/src/index.js";
import { parseSetMessage } from "../../../packages/domain/src/parser/set-parser.js";

describe("release privacy/security boundaries", () => {
  it("rejects zero-rep durable sets on deterministic paths", () => {
    const context = { preferredWeightUnit: "KG" as const, exerciseDefaultLoadSemantics: "TOTAL_LOAD" as const, previousSet: { loadValue: 45, weightUnit: "KG" as const, loadSemantics: "TOTAL_LOAD" as const } };
    for (const text of ["45x0", "same x 0"]) expect(() => parseSetMessage(text, context)).toThrow();
  });
  it("bounds callback bodies even without Content-Length", async () => {
    await expect(boundedWebhookBody(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body: "123456" }), 5)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(await boundedWebhookBody(new Request("http://localhost", { method: "POST", body: "{}" }))).toBe("{}");
  });
  it("returns 429 without executing a session-scoped over-limit handler", async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const request = () => new Request("http://localhost/api/profile", { method: "PATCH", headers: { cookie: "workout_session=rate-fixture" } });
    for (let n = 0; n < 120; n++) expect((await apiResponse(request(), handler)).status).toBe(200);
    const response = await apiResponse(request(), handler); expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60"); expect(handler).toHaveBeenCalledTimes(120);
  });
  it("bounds scoped limits without letting fresh identities evict active limits", () => {
    let now = 0;
    const limit = new RateLimitService(2, 1000, 2, () => now);
    limit.check("a"); limit.check("a"); limit.check("b");
    expect(() => limit.check("a")).toThrow();
    expect(() => limit.check("c")).toThrow();
    limit.check("b"); now = 1001; expect(() => limit.check("a")).not.toThrow();
  });
  it("allowlists log fields and never serializes caller content or credentials", () => {
    const event = safeEvent({ event: "processing_failure", path: "AI", durationMs: 4, code: "AI_PROVIDER_HTTP_ERROR", text: "private workout", token: "credential", userId: "phone" } as any);
    expect(event).toEqual({ event: "processing_failure", path: "AI", durationMs: 4, code: "AI_PROVIDER_HTTP_ERROR" });
    expect(safeEvent({ event: "processing_failure", code: "secret value", durationMs: Infinity })).toEqual({ event: "processing_failure" });
  });
  it("requires production config without printing values", () => {
    expect(() => runtimeEnv({ NODE_ENV: "production", DATABASE_URL: "secret" })).toThrow(/configuration/);
    expect(() => runtimeEnv({ NODE_ENV: "production", DATABASE_URL: "secret" })).not.toThrow(/secret/);
  });
  it("hides unexpected errors, denies cross-origin mutation and returns no-store errors", async () => {
    const handler = vi.fn(async () => { throw new Error("password=private"); });
    const response = await apiResponse(new Request("http://localhost/api/profile"), handler);
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("private");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const blocked = await apiResponse(new Request("http://localhost/api/profile", { method: "PATCH", headers: { origin: "https://other.example" } }), handler);
    expect(blocked.status).toBe(403); expect(handler).toHaveBeenCalledTimes(1);
  });
  it("logs only a SQLSTATE code for unexpected database failures, never the message", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const missingColumn = Object.assign(new Error('column "workout_reminders_enabled" does not exist for user@example.com'), { code: "42703" });
      const response = await apiResponse(new Request("http://localhost/api/profile"), async () => { throw missingColumn; });
      expect(response.status).toBe(500); expect(await response.text()).not.toContain("workout_reminders_enabled");
      const logged = log.mock.calls.map(call => String(call[0])).join("\n");
      expect(logged).toContain('"code":"DB_42703"'); expect(logged).not.toContain("example.com"); expect(logged).not.toContain("does not exist");
      expect(failureCode(new Error("plain"))).toBe("REQUEST_FAILED");
      expect(failureCode(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("REQUEST_FAILED");
    } finally { log.mockRestore(); }
  });
  it("requires authenticity before payload parsing and rejects malformed signed payloads", () => {
    const adapter = new WhatsAppInboundAdapter("fixture-secret");
    expect(() => adapter.normalize("invalid-json", "bad")).toThrow(/signature/);
    expect(() => adapter.normalize("{}", adapter.sign("{}"))).toThrow();
  });
  it("allows same-origin development signup alongside a tunnel but keeps production strict", async () => {
    vi.stubEnv("APP_ORIGIN", "https://workout.example");
    vi.stubEnv("NODE_ENV", "development");
    const handler = vi.fn(async () => ({ ok: true }));
    const request = (origin: string) => new Request("http://localhost:3000/api/auth/signup", {
      method: "POST", headers: { host: "localhost:3000", origin }
    });
    try {
      expect((await apiResponse(request("http://localhost:3000"), handler)).status).toBe(200);
      expect((await apiResponse(request("https://workout.example"), handler)).status).toBe(200);
      expect((await apiResponse(request("https://other.example"), handler)).status).toBe(403);
      expect((await apiResponse(request("http://localhost:3001"), handler)).status).toBe(403);
      vi.stubEnv("NODE_ENV", "production");
      expect((await apiResponse(request("http://localhost:3000"), handler)).status).toBe(403);
      expect((await apiResponse(request("https://workout.example"), handler)).status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(3);
    } finally { vi.unstubAllEnvs(); }
  });
});
