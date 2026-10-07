export type SafeEvent = {
  event: "webhook_failure" | "duplicate_message" | "processing_failure" | "ai_failure" | "domain_failure" | "confirmation" | "outbound_failure" | "message_latency";
  path?: "AI" | "DETERMINISTIC";
  code?: string;
  durationMs?: number;
};
export function safeEvent(input: SafeEvent): SafeEvent {
  return {
    event: input.event,
    ...(input.path === "AI" || input.path === "DETERMINISTIC" ? { path: input.path } : {}),
    ...(input.code && /^[A-Z][A-Z0-9_]{0,79}$/.test(input.code) ? { code: input.code } : {}),
    ...(Number.isFinite(input.durationMs) && input.durationMs! >= 0 ? { durationMs: Math.round(input.durationMs!) } : {})
  };
}
