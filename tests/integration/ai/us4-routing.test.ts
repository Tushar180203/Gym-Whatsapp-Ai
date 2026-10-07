import { expect, it } from "vitest";
import { parseUs4Message } from "../../../packages/domain/src/parser/us4-parser.js";
import { hasSetNotation } from "../../../packages/domain/src/parser/set-parser.js";
import { loadEvalCases, runEvalCases } from "../../../packages/evals/src/runner.js";
import { handleDeterministicUs4Message } from "../../../packages/domain/src/messaging/inbound-message-processor.js";
it("explicit US4 notation resolves without an interpreter, conversational text falls back", () => {
  expect(parseUs4Message("actually that was 9")).toEqual({ type: "CORRECT_SET", replacement: { reps: 9 } });
  expect(parseUs4Message("incline set 2 was actually 10")).toMatchObject({ targetRef: "exercise:incline:set:2" });
  expect(parseUs4Message("do shoulder press first")).toMatchObject({ type: "REORDER_EXERCISE", ordinal: 1 });
  expect(parseUs4Message("bench is busy, use the red machine instead")).toBeUndefined();
  expect(hasSetNotation("actually that was 9")).toBe(false);
  expect(parseUs4Message("actually that was 45x9")).toBeUndefined();
});
it("executes the versioned US4 eval fixtures with locally validated mock provider outputs", async () => {
  const cases = loadEvalCases().filter(item => item.id.startsWith("us4-"));
  expect(cases).toHaveLength(12);
  expect(await runEvalCases(cases)).toMatchObject({ total: 12, passed: 12, failed: 0 });
});
it("pending confirmation resolution precedes action parsing and all AI fallback", async () => {
  const calls: string[] = [];
  const result = await handleDeterministicUs4Message("yes", "message", {
    resolveConfirmation: async () => { calls.push("confirmation"); return "Already applied."; },
    resolveScopeClarification: async () => { calls.push("scope"); throw new Error("Must not run"); },
    dispatch: async () => { calls.push("command"); throw new Error("Must not run"); }
  });
  expect(result).toBe("Already applied."); expect(calls).toEqual(["confirmation"]);
});
