import { describe, expect, it } from "vitest";
import { normalizeMessage, parseConversationGrammar } from "./grammar.js";
import { resolveExerciseReference } from "./references.js";
import { parseSetMessage } from "../parser/set-parser.js";

describe("conversation normalization and deterministic grammar", () => {
  it.each(["45 x 10", "45X10", "45 × 10", "45kgs x10", "45 kg for 10", "45 10"])("normalizes lifting notation %s", text => {
    expect(parseConversationGrammar(normalizeMessage(text))).toMatchObject({ kind: "LOG" });
  });
  it.each(["start", "start workout", "let's start", "lets start", "let’s start", "let's go", "lets train", "gym time", "begin", "ready"])("routes start %s", text => {
    expect(parseConversationGrammar(normalizeMessage(text))).toMatchObject({ kind: "ACTION", action: { type: "START_WORKOUT" } });
  });
  it.each(["lets start today", "let's start today", "start now", "start my workout", "start today's workout", "lets start the workout for today", "start workout now", "let's start today please", "lets start todays workout whats the plan today", "let's start, what's the plan?", "start today and show me the plan", "lets start my workout then tell me what's first"])("routes %s to the next planned session, not a session named after the filler", text => {
    expect(parseConversationGrammar(normalizeMessage(text))).toEqual({ kind: "ACTION", action: { type: "START_WORKOUT" } });
  });
  it.each([["start push today", "push"], ["lets start pull", "pull"], ["start legs now", "legs"], ["start upper body", "upper body"], ["start chest and back", "chest and back"], ["lets start push, what's the plan", "push"]])("keeps the named session in %s", (text, sessionRef) => {
    expect(parseConversationGrammar(normalizeMessage(text))).toEqual({ kind: "ACTION", action: { type: "START_WORKOUT", sessionRef } });
  });
  it.each(["just the load for now: 21kg", "the weight was 21 kg", "load: 21 kg", "21kg", "I used 21kg but have not told you the reps"])("retains explicit load-only information: %s",text=>{
    expect(parseConversationGrammar(normalizeMessage(text))).toEqual({kind:"LOAD_ONLY",load:21,unit:"KG"});
  });
  it.each(["what weight should I use, 21kg", "my best weight was 21kg", "change the load to 21kg", "weight was -21kg"])("does not treat a question, correction or invalid value as a load-only draft: %s",text=>{
    expect(parseConversationGrammar(normalizeMessage(text))?.kind).not.toBe("LOAD_ONLY");
  });
  it.each(["another set", "i have to do one set more", "i want to do one more set", "can i do an extra set"])("requests missing values without claiming a completed set: %s", text => {
    expect(parseConversationGrammar(normalizeMessage(text))).toEqual({ kind: "EXTRA_SET", exerciseRef: null });
  });
  it.each(["go back to barbell bench", "i want to go back to barbell bench", "return to barbell bench please"])("navigates to a named exercise: %s", text => {
    expect(parseConversationGrammar(normalizeMessage(text))).toEqual({ kind: "NAVIGATE", exerciseRef: "barbell bench" });
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
