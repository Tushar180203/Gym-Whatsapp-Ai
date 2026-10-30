import { createHash } from "node:crypto";
import { RateLimitService } from "../../../packages/domain/src/rate-limit/rate-limit-service.js";
// Auth is limited per account (normalized email hash) so one client's failed attempts throttle only
// the account it targets; the shared bucket is a high flood ceiling, not the primary control.
const authFlood = new RateLimitService(300);
const authAccount = new RateLimitService(10);
const writes = new RateLimitService(120);
export function limitAuthAttempt(email: string): void {
  authAccount.check(createHash("sha256").update(email.trim().toLowerCase()).digest("hex"));
}
export function limitRequest(request: Request): void {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/auth/")) {
    // Never trust client-controlled forwarded addresses without a deployment-specific proxy policy.
    authFlood.check("auth-entry");
  } else if (!["GET", "HEAD"].includes(request.method) && path !== "/api/webhooks/whatsapp") {
    const session = request.headers.get("cookie")?.match(/(?:^|;\s*)workout_session=([^;]*)/)?.[1] ?? "anonymous";
    writes.check(createHash("sha256").update(session).digest("hex"));
  }
}
