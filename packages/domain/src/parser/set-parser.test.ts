import { describe, expect, it } from "vitest";
import { hasSetNotation, parseSetMessage } from "./set-parser.js";

describe("parseSetMessage", () => {
  it("records completed reps, not the failed ninth attempt", () => {
    expect(hasSetNotation("50x8 failed the 9th")).toBe(true);
    const sets = parseSetMessage("50x8 failed the 9th", { preferredWeightUnit: "KG", exerciseDefaultLoadSemantics: "TOTAL_LOAD" });
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ loadValue: 50, reps: 8, weightUnit: "KG", loadSemantics: "TOTAL_LOAD" });
  });
  it("never splits a correction's standalone numeric value into invented load/reps", () => {
    expect(hasSetNotation("completed set 1 was 12")).toBe(false);
    expect(hasSetNotation("make the last one 10 reps")).toBe(false);
    expect(hasSetNotation("actually that was 45x9")).toBe(false);
    expect(hasSetNotation("45x9")).toBe(true);
  });
  it("parses supported deterministic load notation", () => {
    expect(
      parseSetMessage("45 kg x 10", {
        preferredWeightUnit: "LB",
        exerciseDefaultLoadSemantics: "TOTAL_LOAD"
      })[0]
    ).toMatchObject({ loadValue: 45, weightUnit: "KG", reps: 10, loadSemantics: "TOTAL_LOAD" });

    expect(
      parseSetMessage("45 lb x 10", {
        preferredWeightUnit: "KG",
        exerciseDefaultLoadSemantics: "TOTAL_LOAD"
      })[0]
    ).toMatchObject({ loadValue: 45, weightUnit: "LB", reps: 10 });

    expect(
      parseSetMessage("45 each 10", {
        preferredWeightUnit: "KG",
        exerciseDefaultLoadSemantics: "TOTAL_LOAD"
      })[0]
    ).toMatchObject({ loadValue: 45, weightUnit: "KG", reps: 10, loadSemantics: "PER_HAND_PER_SIDE" });
  });

  it("parses multiple sets and deterministic same", () => {
    expect(
      parseSetMessage("45x10, 45x9, 45x8", {
        preferredWeightUnit: "KG",
        exerciseDefaultLoadSemantics: "UNSPECIFIED_DEFAULT"
      })
    ).toHaveLength(3);

    expect(
      parseSetMessage("same x 9", {
        preferredWeightUnit: "KG",
        exerciseDefaultLoadSemantics: "UNSPECIFIED_DEFAULT",
        previousSet: { loadValue: 45, weightUnit: "KG", loadSemantics: "PER_HAND_PER_SIDE" }
      })[0]
    ).toMatchObject({ loadValue: 45, weightUnit: "KG", loadSemantics: "PER_HAND_PER_SIDE", reps: 9 });
  });

  it("does not invent missing same context", () => {
    expect(() =>
      parseSetMessage("same x 9", {
        preferredWeightUnit: "KG",
        exerciseDefaultLoadSemantics: "UNSPECIFIED_DEFAULT"
      })
    ).toThrow(/same/);
  });
});
