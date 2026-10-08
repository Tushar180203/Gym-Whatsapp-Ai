import { describe, expect, it } from "vitest";
import { normalizeMessage, parseConversationGrammar } from "./grammar.js";
import { resolveExerciseReference } from "./references.js";
import { parseSetMessage } from "../parser/set-parser.js";

describe("conversation normalization and deterministic grammar", () => {
  it.each(["45 x 10", "45X10", "45 × 10", "45kgs x10", "45 kg for 10", "45 10"])("normalizes lifting notation %s", text => {
    expect(parseConversationGrammar(normalizeMessage(text))).toMatchObject({ kind: "LOG" });
  });
  it.each(["start", "start workout", "let's go", "lets train", "gym time", "begin", "ready"])("routes start %s", text => {
    expect(parseConversationGrammar(normalizeMessage(text))).toMatchObject({ kind: "ACTION", action: { type: "START_WORKOUT" } });
  });
  it.each(["actually 9", "that was 9", "sorry 9 reps", "change my last set to 9 reps"])("retains explicit correction values %s", text => {
    expect(parseConversationGrammar(normalizeMessage(text))).toMatchObject({ kind: "ACTION", action: { type: "CORRECT_SET", replacement: { reps: 9 } } });
  });
  it.each(["swap bench for cable fly today", "replace bench with cable fly this workout", "do cable fly instead of bench today"])("session-only replacement %s", text => {
    expect(parseConversationGrammar(normalizeMessage(text))).toMatchObject({ kind: "REPLACE", source: "bench", replacement: "cable fly", scope: "SESSION_ONLY" });
  });
  it("keeps missing replacement/scope as typed slots", () => {
    expect(parseConversationGrammar("replace bench")).toMatchObject({ kind: "REPLACE", source: "bench", replacement: null, scope: "AMBIGUOUS" });
  });
  it("allows only log then next as a deterministic compound", () => {
    expect(parseConversationGrammar("45x10 and next")).toMatchObject({ kind: "LOG_NEXT" });
    expect(parseConversationGrammar("45x10 and delete history")).not.toMatchObject({ kind: "LOG_NEXT" });
  });
  it.each(["what should I do according to my plan", "what am I doing today", "show today"])("plan facts are not coaching %s", text => {
    expect(parseConversationGrammar(text)).toMatchObject({ kind: "FACT", query: "PLAN" });
  });
  it("generated notation variants preserve every supplied numeric value and per-side semantics", () => {
    for (let load = 0; load <= 100; load += 5) for (const reps of [1, 8, 10, 20]) for (const separator of ["x", " X ", " × ", " for "]) {
      const text = normalizeMessage(`${load}kgs${separator}${reps}`);
      expect(parseConversationGrammar(text)?.kind).toBe("LOG");
      expect(parseSetMessage(text, { preferredWeightUnit: "LB", exerciseDefaultLoadSemantics: "PER_HAND_PER_SIDE" })).toEqual([{ loadValue: load, weightUnit: "KG", loadSemantics: "PER_HAND_PER_SIDE", reps, usesSame: false }]);
    }
  });
});

describe("contextual references cannot invent identities", () => {
  const exercises = [
    { id: "a", identityId: "bench", name: "Barbell Bench", aliases: ["bench"], order: 0, status: "IN_PROGRESS" },
    { id: "b", identityId: "fly", name: "Cable Fly", aliases: ["fly"], order: 1, status: "PLANNED" }
  ];
  it.each([["that", "a"], ["next exercise", "b"], ["second exercise", "b"], ["barbel bench", "a"], ["cabel fly", "b"]])("resolves %s safely", (ref, id) => {
    expect(resolveExerciseReference(ref, exercises, "a")).toMatchObject({ status: "RESOLVED", exercise: { id } });
  });
  it("ambiguous aliases never choose a target", () => {
    expect(resolveExerciseReference("bench", [...exercises, { ...exercises[0]!, id: "c", identityId: "incline" }], "a").status).toBe("AMBIGUOUS");
  });
  it("unrelated unknown names are not autocorrected", () => {
    expect(resolveExerciseReference("red machine", exercises, "a").status).toBe("UNKNOWN");
  });
  it("punctuation-only references cannot collapse distinct names into a durable target", () => {
    const symbols = [{ ...exercises[0]!, name: "---", aliases: [] }];
    expect(resolveExerciseReference("???", symbols, "a").status).toBe("UNKNOWN");
    expect(resolveExerciseReference("bench", exercises, "b")).toMatchObject({ status: "RESOLVED", exercise: { id: "a" } });
  });
});
