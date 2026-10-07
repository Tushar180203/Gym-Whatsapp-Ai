import { describe, expect, it } from "vitest";
import { deletionDecision } from "./deletion-service.js";
const request = { userId: "a", status: "AWAITING_CONFIRMATION", expiresAt: new Date("2026-10-07T12:10Z"), targetDigest: "original" };
describe("deterministic destructive confirmation", () => {
  it("requires owner and explicit confirmation, never grants authority through a request ID", () => {
    expect(deletionDecision(request, "b", true, "original", new Date("2026-10-07T12:01Z"))).toBe("NOT_FOUND");
    expect(deletionDecision(request, "a", false, "original", new Date("2026-10-07T12:01Z"))).toBe("CONFIRMATION_REQUIRED");
    expect(deletionDecision(request, "a", true, "original", new Date("2026-10-07T12:01Z"))).toBe("APPLY");
  });
  it("expired and changed targets never execute", () => {
    expect(deletionDecision(request, "a", true, "original", request.expiresAt)).toBe("EXPIRED");
    expect(deletionDecision(request, "a", true, "changed", new Date("2026-10-07T12:01Z"))).toBe("STALE");
  });
  it("completed confirmations replay only for the owner", () => {
    expect(deletionDecision({ ...request, status: "COMPLETED" }, "a", true, "changed", request.expiresAt)).toBe("REUSE");
    expect(deletionDecision({ ...request, status: "COMPLETED" }, "b", true, "changed", request.expiresAt)).toBe("NOT_FOUND");
  });
});
