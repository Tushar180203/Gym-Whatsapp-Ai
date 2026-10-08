export type SafeEvent = {
  event: "webhook_failure" | "duplicate_message" | "processing_failure" | "ai_failure" | "domain_failure" | "confirmation" | "outbound_failure" | "outbound_delivery" | "message_latency" | "conversation_route";
  path?: "AI" | "DETERMINISTIC";
  code?: string;
  durationMs?: number;
  outboundId?: string;
  recipientIdentityId?: string;
  status?: "SENDING" | "SENT" | "FAILED_RETRYABLE" | "FAILED_FINAL";
  conversationMode?: "IDLE" | "WORKOUT_PROPOSED" | "WORKOUT_ACTIVE" | "WORKOUT_FINISH_PENDING";
  routeStage?: string;
  pendingActionType?: string;
  resolvedIntent?: string;
  aiInvoked?: boolean;
  aiActionType?: string;
  clarificationReason?: string;
  confirmationRequired?: boolean;
  executionResult?: string;
};
export function safeEvent(input: SafeEvent): SafeEvent {
  return {
    event: input.event,
    ...(input.path === "AI" || input.path === "DETERMINISTIC" ? { path: input.path } : {}),
    ...(input.code && /^[A-Z][A-Z0-9_]{0,79}$/.test(input.code) ? { code: input.code } : {}),
    ...(Number.isFinite(input.durationMs) && input.durationMs! >= 0 ? { durationMs: Math.round(input.durationMs!) } : {}),
    ...(input.outboundId && /^outbound_[a-f0-9]{24}$/.test(input.outboundId) ? { outboundId: input.outboundId } : {}),
    ...(input.recipientIdentityId && /^wpi_[a-f0-9]{24}$/.test(input.recipientIdentityId) ? { recipientIdentityId: input.recipientIdentityId } : {}),
    ...(input.status && ["SENDING", "SENT", "FAILED_RETRYABLE", "FAILED_FINAL"].includes(input.status) ? { status: input.status } : {}),
    ...Object.fromEntries(["conversationMode", "routeStage", "pendingActionType", "resolvedIntent", "aiActionType", "clarificationReason", "executionResult"].flatMap(key => {
      const value = input[key as keyof SafeEvent];
      return typeof value === "string" && /^[A-Z][A-Z_]{0,60}$/.test(value) ? [[key, value]] : [];
    })),
    ...(typeof input.aiInvoked === "boolean" ? { aiInvoked: input.aiInvoked } : {}),
    ...(typeof input.confirmationRequired === "boolean" ? { confirmationRequired: input.confirmationRequired } : {})
  };
}
