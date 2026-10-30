import { describe, expect, it } from "vitest";
import { requiresCompletionChoice } from "./completion-policy.js";
describe("explicit workout completion", () => {
  it("requires choices for empty, unfinished, or unplanned-target work", () => {
    expect(requiresCompletionChoice([], 0)).toBe(true);
    expect(requiresCompletionChoice([{ status: "IN_PROGRESS", plannedSets: 3, recordedSets: 2, skippedSets: 0 }], 2)).toBe(true);
    expect(requiresCompletionChoice([{ status: "IN_PROGRESS", plannedSets: null, recordedSets: 1, skippedSets: 0 }], 1)).toBe(true);
  });
  it("permits fully recorded/skipped/replaced planned work without advancing context", () => {
    expect(requiresCompletionChoice([{ status: "IN_PROGRESS", plannedSets: 3, recordedSets: 2, skippedSets: 1 }, { status: "SKIPPED", plannedSets: 3, recordedSets: 0, skippedSets: 0 }, { status: "REPLACED", plannedSets: 3, recordedSets: 0, skippedSets: 0 }], 2)).toBe(false);
  });
});
