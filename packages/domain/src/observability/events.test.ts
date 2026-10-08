import { describe, expect, it } from "vitest";
import { safeEvent, type SafeEvent } from "./events.js";
describe("conversation routing telemetry", () => {
  it("allows structured route decisions without retaining raw content", () => {
    const input = { event: "conversation_route", conversationMode: "WORKOUT_ACTIVE", routeStage: "CLARIFICATION", pendingActionType: "REPLACE", resolvedIntent: "REPLACE_EXERCISE", aiInvoked: false, clarificationReason: "AMBIGUOUS_SCOPE", confirmationRequired: false, executionResult: "REPLIED", rawChat: "private text", phoneNumber: "+15555550123", apiKey: "secret" };
    expect(safeEvent(input as SafeEvent)).toEqual({ event: "conversation_route", conversationMode: "WORKOUT_ACTIVE", routeStage: "CLARIFICATION", pendingActionType: "REPLACE", resolvedIntent: "REPLACE_EXERCISE", aiInvoked: false, clarificationReason: "AMBIGUOUS_SCOPE", confirmationRequired: false, executionResult: "REPLIED" });
  });
  it("drops free-form values in route fields", () => {
    expect(safeEvent({ event: "conversation_route", routeStage: "user phone +15555550123", aiActionType: "raw provider credentials", clarificationReason: "private workout content" })).toEqual({ event: "conversation_route" });
  });
});
