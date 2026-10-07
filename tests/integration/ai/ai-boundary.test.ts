import { describe, expect, it, vi } from "vitest";
import { evaluateConfirmationPolicy, parseProposedActionEnvelope } from "../../../packages/contracts/src/index.js";
import { DomainError } from "../../../packages/persistence/src/index.js";
import {
  AiProviderError,
  MockStructuredOutputClient,
  StaticPromptRegistry,
  StructuredIntentInterpreter,
  interpretWithDeterministicFirst
} from "../../../packages/ai/src/index.js";
import { guardProposedAction } from "../../../packages/ai/src/action-boundary.js";
import { parseSetMessage } from "../../../packages/domain/src/parser/set-parser.js";

describe("AI boundary integration", () => {
  it("does not call AI for deterministic successes", async () => {
    const client = new MockStructuredOutputClient([
      {
        schemaVersion: "workout-action.v1",
        action: { type: "UNKNOWN", reason: "should not be used" },
        confidence: "high",
        requiresClarification: false,
        rationaleCodes: ["UNUSED"],
        forbiddenDirectMutation: true
      }
    ]);
    const interpreter = new StructuredIntentInterpreter(client, new StaticPromptRegistry("mock-model"));
    const result = await interpretWithDeterministicFirst(
      () => parseSetMessage("45x10", { preferredWeightUnit: "KG", exerciseDefaultLoadSemantics: "TOTAL_LOAD" }),
      () =>
        interpreter.interpret({
          userInput: "45x10",
          idempotencyKey: "deterministic",
          context: { userId: "user-1" }
        })
    );
    expect(result).toMatchObject({ source: "DETERMINISTIC", aiCalled: false });
    expect(client.requests).toHaveLength(0);
  });

  it("validates AI output locally before any domain command could execute", async () => {
    const client = new MockStructuredOutputClient([
      {
        schemaVersion: "workout-action.v1",
        action: { type: "LOG_SET", set: { loadValue: 45, weightUnit: "KG", loadSemantics: "TOTAL_LOAD" } },
        confidence: "high",
        requiresClarification: false,
        rationaleCodes: ["MISSING_REPS"],
        forbiddenDirectMutation: true
      }
    ]);
    const interpreter = new StructuredIntentInterpreter(client, new StaticPromptRegistry("mock-model"));
    await expect(
      interpreter.interpret({
        userInput: "45 kg",
        idempotencyKey: "invalid",
        context: { userId: "user-1" }
      })
    ).rejects.toThrow(/reps/);
  });

  it("treats prompt injection as untrusted text and rejects forbidden mutation output", async () => {
    expect(() =>
      parseProposedActionEnvelope({
        schemaVersion: "workout-action.v1",
        action: { type: "UNKNOWN", reason: "injection", sql: "drop table users" },
        confidence: "high",
        requiresClarification: false,
        rationaleCodes: ["PROMPT_INJECTION"],
        forbiddenDirectMutation: true
      })
    ).toThrow(/Forbidden direct-mutation key/);
  });

  it("does not let AI confidence bypass confirmation, authorization, validation, or clarification gates", async () => {
    const envelope = parseProposedActionEnvelope({
      schemaVersion: "workout-action.v1",
      action: { type: "UPDATE_ROUTINE_REQUEST", scope: "PERMANENT_ROUTINE", requestedChange: { operation: "REMOVE_EXERCISE", sessionRef: "upper", exerciseRef: "bench" } },
      confidence: "high",
      requiresClarification: false,
      rationaleCodes: ["PERMANENT_CHANGE"],
      forbiddenDirectMutation: true
    });
    expect(evaluateConfirmationPolicy(envelope)).toMatchObject({ confirmationRequired: true });

    const lowConfidenceClarification = parseProposedActionEnvelope({
      schemaVersion: "workout-action.v1",
      action: { type: "UNKNOWN", reason: "Low-confidence ambiguous request." },
      confidence: "low",
      requiresClarification: true,
      clarificationQuestion: "What should I do with that workout change?",
      rationaleCodes: ["LOW_CONFIDENCE_AMBIGUITY"],
      forbiddenDirectMutation: true
    });
    expect(evaluateConfirmationPolicy(lowConfidenceClarification)).toMatchObject({
      clarificationRequired: true
    });
  });

  it("surfaces provider failure without applying a fallback mutation", async () => {
    const failingInterpreter = new StructuredIntentInterpreter(
      {
        async createStructuredOutput() {
          throw new AiProviderError("provider down", "AI_PROVIDER_DOWN", true);
        }
      },
      new StaticPromptRegistry("mock-model")
    );

    await expect(
      interpretWithDeterministicFirst(
        () => {
          throw new DomainError("No deterministic notation", "NO_SET_NOTATION");
        },
        () =>
          failingInterpreter.interpret({
            userInput: "swap something",
            idempotencyKey: "provider-failure",
            context: { userId: "user-1" }
          })
      )
    ).rejects.toMatchObject({ code: "AI_PROVIDER_DOWN", retryable: true });
  });

  it("falls back to AI only for deterministic parse failure", async () => {
    const result = await interpretWithDeterministicFirst(
      () => {
        throw new DomainError("No deterministic notation", "NO_SET_NOTATION");
      },
      async () =>
        parseProposedActionEnvelope({
          schemaVersion: "workout-action.v1",
          action: { type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: "squat" },
          confidence: "medium",
          requiresClarification: false,
          rationaleCodes: ["AI_FALLBACK"],
          forbiddenDirectMutation: true
        })
    );
    expect(result).toMatchObject({ source: "AI", aiCalled: true });
  });

  it("cannot execute after authorization/domain failure, regardless of confidence", async () => {
    const envelope = {
      schemaVersion: "workout-action.v1", confidence: "high", requiresClarification: false,
      rationaleCodes: [], forbiddenDirectMutation: true,
      action: { type: "LOG_SET", set: { loadValue: 45, reps: 10 } }
    };
    const executeIdempotently = vi.fn(async () => "applied");
    const validateDomain = vi.fn(async () => {});
    await expect(guardProposedAction(envelope, {
      authorize: async () => { throw new Error("owner mismatch"); }, validateDomain, executeIdempotently
    })).rejects.toThrow("owner mismatch");
    expect(validateDomain).not.toHaveBeenCalled();
    await expect(guardProposedAction(envelope, {
      authorize: async () => {}, validateDomain: async () => { throw new Error("missing load unit"); }, executeIdempotently
    })).rejects.toThrow("missing load unit");
    expect(executeIdempotently).not.toHaveBeenCalled();
  });

  it("stops permanent/destructive/ambiguous proposals before execution", async () => {
    const executeIdempotently = vi.fn(async () => "applied");
    for (const action of [
      { type: "DELETE_SET", targetRef: "history:last-month" },
      { type: "ADD_EXERCISE", exerciseRef: "bench", scope: "PERMANENT_ROUTINE" },
      { type: "ADD_EXERCISE", exerciseRef: "bench", scope: "AMBIGUOUS" }
    ]) {
      const result = await guardProposedAction({
        schemaVersion: "workout-action.v1", confidence: "high", requiresClarification: false,
        rationaleCodes: [], forbiddenDirectMutation: true, action
      }, { authorize: async () => {}, validateDomain: async () => {}, executeIdempotently });
      expect(result.status).not.toBe("EXECUTED");
    }
    expect(executeIdempotently).not.toHaveBeenCalled();
  });

  it("does not call AI for unresolved same or failed deterministic domain validation", async () => {
    const ai = vi.fn();
    await expect(interpretWithDeterministicFirst(
      () => parseSetMessage("same x 9", { preferredWeightUnit: "KG", exerciseDefaultLoadSemantics: "TOTAL_LOAD" }), ai
    )).rejects.toMatchObject({ code: "AMBIGUOUS_SAME" });
    expect(ai).not.toHaveBeenCalled();
  });
});
