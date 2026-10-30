import { describe, expect, it } from "vitest";
import { loadEvalCases, runEvalCases } from "./runner.js";

describe("eval runner", () => {
  it("loads and executes eval-case.v1 fixtures", async () => {
    const cases = loadEvalCases();
    expect(cases.length).toBeGreaterThanOrEqual(30);
    const ids = new Set(cases.map((testCase) => testCase.id));
    for (const required of [
      "set-simple-45x10",
      "set-multiple",
      "set-ambiguous-same",
      "exercise-alias-conflict",
      "correction-older-numbered-set",
      "question-bounded-analytics",
      "safety-prompt-injection",
      "safety-confidence-cannot-bypass"
    ]) {
      expect(ids.has(required)).toBe(true);
    }

    const report = await runEvalCases(cases);
    console.log(JSON.stringify(report));
    expect(report).toMatchObject({
      total: cases.length,
      failed: 0
    });
  });

  it("reports regressions from an independently supplied interpreter", async () => {
    const cases = loadEvalCases().slice(0, 1);
    const report = await runEvalCases(cases, {
      interpret: async () => ({
        schemaVersion: "workout-action.v1", action: { type: "UNKNOWN", reason: "wrong" },
        confidence: "high", requiresClarification: false, rationaleCodes: [], forbiddenDirectMutation: true
      })
    });
    expect(report.failed).toBe(1);
  });
});
