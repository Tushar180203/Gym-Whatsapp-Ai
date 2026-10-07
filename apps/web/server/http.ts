import { DomainError } from "../../../packages/persistence/src/store.js";
import { ZodError } from "zod";
import { AiProviderError } from "../../../packages/ai/src/interfaces.js";
export const sessionCookie = "workout_session";
export function requestSession(request: Request): string {
  return request.headers.get("cookie")?.split(";").map(item => item.trim()).find(item => item.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1) ?? "";
}
export async function apiResponse(request: Request, handler: () => Promise<unknown>): Promise<Response> {
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.get("origin");
      const url = new URL(request.url);
      const expectedOrigin = process.env.APP_ORIGIN ?? `${url.protocol}//${request.headers.get("host") ?? url.host}`;
      if (origin && origin !== expectedOrigin) return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    return Response.json(await handler(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof DomainError ? error.code === "UNAUTHENTICATED" ? 401 : error.code === "NOT_FOUND" ? 404 : error.code === "STALE_VERSION" ? 409 : 400
      : error instanceof AiProviderError && error.retryable ? 503
      : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
    return Response.json({ error: status === 409 ? "Workout changed. Refresh before editing." : status === 401 ? "Authentication required." : status === 404 ? "Record not found." : "Request could not be applied." }, { status });
  }
}
