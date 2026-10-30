import { describe, expect, it } from "vitest";
import { hasPerHandEvidence, hasSetCountEvidence, numericEvidence, hasExplicitUnit } from "./numeric-evidence.js";
describe("local numeric evidence", () => {
  it("retains explicit set counts with completion and exercise words", () => {
    expect(hasSetCountEvidence("log my three completed bench sets: 45kg for 7 each",3,[7,7,7])).toBe(true);
    expect(hasSetCountEvidence("three recorded working sets at 45kg for 7 each",3,[7,7,7])).toBe(true);
    expect(hasSetCountEvidence("45kg seven reps on bench",3,[7,7,7])).toBe(false);
    expect(hasSetCountEvidence("three completed bench sets",1,[7])).toBe(false);
  });
  it.each([
    ["seven with forty-five", [7, 45]], ["three sets forty five kilos seven each", [3, 45, 7]],
    ["-45 for 7", [-45, 7]], ["minus forty-five for seven", [-45, 7]], ["45.5kg 7reps", [45.5, 7]], ["45 for 7, 7 and 6", [45, 7, 7, 6]],
    ["forty six", [46]], ["ninety nine", [99]], ["45.05", [45.05]], ["havr reos benhc", []]
  ])("preserves explicit numeric meaning in %s", (text, values) => expect(numericEvidence(text as string)).toEqual(values));
  it("does not infer numbers from a pronoun", () => expect(numericEvidence("same again")).toEqual([]));
  it("recognizes natural units but cannot invent them", () => { expect(hasExplicitUnit("forty-five kilos", "KG")).toBe(true); expect(hasExplicitUnit("45 pounds", "KG")).toBe(false); });
});

it("does not let a single-set proposal under-record an explicitly supplied batch", () => {
  expect(hasSetCountEvidence("-3 sets with 45kg seven reps",3,[7,7,7])).toBe(false);
  expect(hasSetCountEvidence("3sets with 45kg seven reps",3,[7,7,7])).toBe(true);
  expect(hasSetCountEvidence("three sets with forty-five kilos seven reps each",1,[7])).toBe(false);
  expect(hasSetCountEvidence("three set with 45kg seven reps",3,[7,7,7])).toBe(true);
  expect(hasSetCountEvidence("7 reps with 45kg per set, three sets",3,[7,7,7])).toBe(true);
});

it("distinguishes per-hand load evidence from repetitions across sets",()=>{
  expect(hasPerHandEvidence("three sets at 45kg seven reps each",45)).toBe(false);
  expect(hasPerHandEvidence("45kg 7 reps each",45)).toBe(false);
  expect(hasPerHandEvidence("10 each for 15",10)).toBe(true);
  expect(hasPerHandEvidence("three sets with ten kilos per hand for fifteen",10)).toBe(true);
});
