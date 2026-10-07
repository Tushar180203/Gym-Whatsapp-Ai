import { createHash } from "node:crypto";
import { RateLimitService } from "../../../packages/domain/src/rate-limit/rate-limit-service.js";
const auth = new RateLimitService(20);
const writes = new RateLimitService(120);
export function limitRequest(request: Request): void {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/auth/")) {
    // Never trust client-controlled forwarded addresses without a deployment-specific proxy policy.
    auth.check("auth-entry");
  } else if (!["GET", "HEAD"].includes(request.method) && path !== "/api/webhooks/whatsapp") {
    const session = request.headers.get("cookie")?.match(/(?:^|;\s*)workout_session=([^;]*)/)?.[1] ?? "anonymous";
    writes.check(createHash("sha256").update(session).digest("hex"));
  }
}
