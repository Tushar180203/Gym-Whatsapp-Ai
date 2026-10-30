import { describe, expect, it } from "vitest";
import { limitAuthAttempt, limitRequest } from "../../../apps/web/server/rate-limit.js";

// Constitution XII: one client's failed sign-ins must not lock every other user out.
describe("auth rate limiting", () => {
  it("throttles repeated attempts per account without blocking other accounts", () => {
    for (let attempt = 0; attempt < 10; attempt++) limitAuthAttempt("Target@Example.com");
    expect(() => limitAuthAttempt(" target@example.com ")).toThrow(expect.objectContaining({ code: "RATE_LIMITED" }));
    expect(() => limitAuthAttempt("someone-else@example.com")).not.toThrow();
  });

  it("allows more than the per-account limit across different accounts before the shared ceiling", () => {
    const login = () => new Request("http://localhost/api/auth/login", { method: "POST" });
    for (let attempt = 0; attempt < 50; attempt++) {
      expect(() => limitRequest(login())).not.toThrow();
      expect(() => limitAuthAttempt(`user-${attempt}@example.com`)).not.toThrow();
    }
  });
});
