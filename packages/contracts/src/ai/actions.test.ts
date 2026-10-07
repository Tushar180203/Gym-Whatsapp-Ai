import { describe, expect, it } from "vitest";
import { evaluateConfirmationPolicy, parseProposedActionEnvelope, ProposedActionSchemaError } from "./actions.js";

const baseEnvelope = {
  schemaVersion: "workout-action.v1",
  confidence: "high",
  requiresClarification: false,
  rationaleCodes: ["TEST"],
  forbiddenDirectMutation: true
};

describe("ProposedActionEnvelope validation", () => {
  it("accepts valid structured action envelopes", () => {
    const parsed = parseProposedActionEnvelope({
      ...baseEnvelope,
      action: { type: "LOG_SET", set: { loadValue: 45, weightUnit: "KG", loadSemantics: "TOTAL_LOAD", reps: 10 } }
    });
    expect(parsed.action.type).toBe("LOG_SET");
  });

  it("rejects invalid schema and forbidden direct mutation fields", () => {
    expect(() =>
      parseProposedActionEnvelope({
        ...baseEnvelope,
        action: { type: "LOG_SET", set: { loadValue: 45, reps: 10 }, sql: "update workout_sets" }
      })
    ).toThrow(ProposedActionSchemaError);

    expect(() =>
      parseProposedActionEnvelope({
        ...baseEnvelope,
        forbiddenDirectMutation: false,
        action: { type: "UNKNOWN", reason: "nope" }
      })
    ).toThrow(ProposedActionSchemaError);
  });

  it.each([
    { type: "FINISH_WORKOUT", requestedCompletion: "ERASE" },
    { type: "QUERY_HISTORY", queryKind: "SQL" },
    { type: "QUERY_ANALYTICS", queryKind: "COACH" },
    { type: "UPDATE_ROUTINE_REQUEST", scope: "PERMANENT_ROUTINE", requestedChange: { operation: "DROP_TABLE" } },
    { type: "QUERY_HISTORY", queryKind: "LAST_SESSION", subject: { kind: "OTHER", exerciseRef: "bench" } },
    { type: "UNKNOWN", reason: "test", authorize: true }
  ])("rejects unsupported action fields: %j", (action) => {
    expect(() => parseProposedActionEnvelope({ ...baseEnvelope, action })).toThrow(ProposedActionSchemaError);
  });

  it("does not let confidence bypass confirmation or clarification policy", () => {
    const destructive = parseProposedActionEnvelope({
      ...baseEnvelope,
      confidence: "high",
      action: { type: "DELETE_SET", targetRef: "history:last-month" }
    });
    expect(evaluateConfirmationPolicy(destructive)).toMatchObject({
      confirmationRequired: true,
      clarificationRequired: false
    });

    const ambiguousPermanent = parseProposedActionEnvelope({
      ...baseEnvelope,
      confidence: "high",
      requiresClarification: true,
      clarificationQuestion: "Is that for today or permanent?",
      action: { type: "REPLACE_EXERCISE", fromExerciseRef: "bench", toExerciseRef: "dips", scope: "AMBIGUOUS" }
    });
    expect(evaluateConfirmationPolicy(ambiguousPermanent)).toMatchObject({
      confirmationRequired: false,
      clarificationRequired: true
    });
  });
});
