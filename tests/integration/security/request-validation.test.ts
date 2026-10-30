import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as signup } from "../../../apps/web/app/api/auth/signup/route.js";
import { POST as login } from "../../../apps/web/app/api/auth/login/route.js";
import { PATCH as profile } from "../../../apps/web/app/api/profile/route.js";
import { boundedRequestBody } from "../../../apps/web/server/http.js";

const services = vi.hoisted(() => ({ signUp: vi.fn(), signIn: vi.fn(), configure: vi.fn() }));
vi.mock("../../../apps/web/server/app.js", () => ({ productionApp: () => services }));
vi.mock("../../../apps/web/server/rate-limit.js", () => ({ limitRequest: vi.fn(), limitAuthAttempt: vi.fn() }));

const credentials = { email: "validation@example.com", password: "correct horse battery staple" };
const request = (body: string, contentType = "application/json", headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/profile", {
    method: "PATCH", headers: { "content-type": contentType, ...headers }, body
  });

// FR-001 / FR-072 and constitution XII: reject untrusted input before application work.
describe("API input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    services.signUp.mockResolvedValue({ userId: "owner", sessionToken: "fixture-session" });
    services.signIn.mockResolvedValue({ userId: "owner", sessionToken: "fixture-session" });
    services.configure.mockResolvedValue({ ok: true });
  });

  it("rejects oversized bodies without trusting a missing or understated Content-Length", async () => {
    const body = JSON.stringify({ displayName: "x".repeat(1024 * 1024), preferredWeightUnit: "KG" });
    for (const headers of [{}, { "content-length": "1" }]) {
      const response = await profile(request(body, "application/json", headers));
      expect(response.status).toBe(413);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(services.configure).not.toHaveBeenCalled();
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"])(
    "rejects %s bodies before application services run", async contentType => {
      expect((await profile(request('{"preferredWeightUnit":"KG"}', contentType))).status).toBe(415);
      expect(services.configure).not.toHaveBeenCalled();
    }
  );

  it.each(["{", "", "null", "[]", '"text"', "123", "true"])(
    "rejects malformed or non-object JSON: %s", async body => {
      const response = await profile(request(body));
      expect(response.status).toBe(400);
      expect(services.configure).not.toHaveBeenCalled();
    }
  );

  it("rejects a missing JSON content type", async () => {
    const input = request("{}");
    input.headers.delete("content-type");
    expect((await profile(input)).status).toBe(415);
    expect(services.configure).not.toHaveBeenCalled();
  });

  it("allows normal JSON with charset parameters", async () => {
    expect((await profile(request('{"preferredWeightUnit":"KG"}', "application/json; charset=utf-8"))).status).toBe(200);
    expect(services.configure).toHaveBeenCalledOnce();
  });

  it("counts streamed UTF-8 bytes and cancels the source as soon as the limit is exceeded", async () => {
    const cancel = vi.fn();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("éé"));
        controller.enqueue(encoder.encode("é"));
      }, cancel
    });
    const input = new Request("http://localhost/api/profile", {
      method: "PATCH", body: stream, duplex: "half"
    } as RequestInit);
    await expect(boundedRequestBody(input, 5)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(await boundedRequestBody(request("éé"), 4)).toBe("éé");
  });

  it("keeps signup and login password maximums consistent before password hashing", async () => {
    for (const route of [signup, login]) {
      expect((await route(request(JSON.stringify({ ...credentials, password: "p".repeat(257) })))).status).toBe(400);
    }
    expect(services.signUp).not.toHaveBeenCalled();
    expect(services.signIn).not.toHaveBeenCalled();
  });

  it("rejects overlong email addresses and injected ownership fields", async () => {
    for (const route of [signup, login]) {
      for (const input of [
        { ...credentials, email: `${"x".repeat(255)}@example.com` },
        { ...credentials, userId: "other-owner" },
        { ...credentials, email: "not-an-email" }
      ]) expect((await route(request(JSON.stringify(input)))).status).toBe(400);
    }
    expect(services.signUp).not.toHaveBeenCalled();
    expect(services.signIn).not.toHaveBeenCalled();
  });

  it("preserves valid credentials exactly and keeps the session out of the response body", async () => {
    const input = { ...credentials, password: ` ${"p".repeat(254)} ` };
    for (const route of [signup, login]) {
      const response = await route(request(JSON.stringify(input)));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ userId: "owner" });
      expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
    }
    expect(services.signUp).toHaveBeenCalledWith(input.email, input.password);
    expect(services.signIn).toHaveBeenCalledWith(input.email, input.password);
  });
});
