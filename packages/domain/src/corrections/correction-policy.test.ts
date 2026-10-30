import { describe, expect, it } from "vitest";
import { resolveCorrectionTarget, type SetTarget } from "./correction-target-resolver.js";
import { correctedSet, correctionNeedsConfirmation } from "./correction-command.js";
const sets: SetTarget[] = [1, 2].map(n => ({ id: `set${n}`, workoutId: "w", exerciseId: "incline", exerciseName: "Incline Dumbbell Press", setIndex: n, workoutStatus: "ACTIVE", createdAt: `2026-10-07T00:00:0${n}Z` }));
describe("US4 correction policy", () => {
  it("resolves immediate and named/ordinal references independently of active exercise", () => {
    expect(resolveCorrectionTarget(sets, undefined, "w")).toMatchObject({ target: { id: "set2" } });
    expect(resolveCorrectionTarget(sets, "exercise:incline:set:2", "w")).toMatchObject({ target: { id: "set2" } });
    expect(resolveCorrectionTarget(sets, "incline 1", "w")).toMatchObject({ target: { id: "set1" } });
  });
  it("clarifies ambiguous exercise/set or duplicate timestamps", () => {
    expect(resolveCorrectionTarget(sets, "incline", "w").status).toBe("CLARIFY");
    expect(resolveCorrectionTarget([...sets, { ...sets[1]!, id: "other" }], undefined, "w").status).toBe("CLARIFY");
    expect(resolveCorrectionTarget([...sets, { ...sets[1]!, id: "similar", exerciseId: "other-identity", exerciseName: "Incline Machine Press" }], "exercise:incline:set:2", "w").status).toBe("CLARIFY");
  });
  it("completed WhatsApp targets require confirmation; authenticated web edits do not", () => {
    expect(correctionNeedsConfirmation("COMPLETED", "WHATSAPP")).toBe(true);
    expect(correctionNeedsConfirmation("COMPLETED", "WEB")).toBe(false);
  });
  it("keeps current load semantics and rejects invented/invalid values", () => {
    const before = { loadValue: 45, weightUnit: "LB", loadSemantics: "PER_HAND_PER_SIDE", reps: 10 } as const;
    expect(correctedSet(before, { reps: 9 }, "actually that was 9")).toEqual({ ...before, reps: 9 });
    expect(() => correctedSet(before, { reps: 12 }, "actually that was 9")).toThrow();
    expect(() => correctedSet(before, { reps: 0 })).toThrow();
  });
});
