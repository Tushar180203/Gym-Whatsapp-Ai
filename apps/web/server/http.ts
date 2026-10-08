import { DomainError } from "../../../packages/persistence/src/store.js";
import { ZodError } from "zod";
import { AiProviderError } from "../../../packages/ai/src/interfaces.js";
import { limitRequest } from "./rate-limit.js";
import { observe } from "./observability.js";
export const sessionCookie = "workout_session";
export async function boundedWebhookBody(request: Request, maximumBytes = 1024 * 1024): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder(); let bytes = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) { await reader.cancel(); throw new DomainError("Payload too large", "PAYLOAD_TOO_LARGE"); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
export function requestSession(request: Request): string {
  return request.headers.get("cookie")?.split(";").map(item => item.trim()).find(item => item.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1) ?? "";
}
export async function apiResponse(request: Request, handler: () => Promise<unknown>): Promise<Response> {
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.get("origin");
      const url = new URL(request.url);
      const expectedOrigin = process.env.APP_ORIGIN ?? `${url.protocol}//${request.headers.get("host") ?? url.host}`;
      if (origin && origin !== expectedOrigin) return Response.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    limitRequest(request);
    return Response.json(await handler(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    observe({ event: new URL(request.url).pathname === "/api/webhooks/whatsapp" ? "webhook_failure" : "domain_failure", code: error instanceof DomainError || error instanceof AiProviderError ? error.code : "REQUEST_FAILED" });
    const status = error instanceof DomainError ? error.code === "PAYLOAD_TOO_LARGE" ? 413 : error.code === "RATE_LIMITED" ? 429 : error.code === "UNAUTHENTICATED" ? 401 : error.code === "NOT_FOUND" ? 404 : error.code === "STALE_VERSION" ? 409 : 400
      : error instanceof AiProviderError && error.retryable ? 503
      : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
    return Response.json({ error: error instanceof DomainError && error.code === "SIGNUP_UNAVAILABLE" ? "Account could not be created. Try signing in or use a different email." : status === 429 ? "Too many requests. Try again shortly." : status === 409 ? "Workout changed. Refresh before editing." : status === 401 ? "Authentication required." : status === 404 ? "Record not found." : "Request could not be applied." }, { status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  }
}
