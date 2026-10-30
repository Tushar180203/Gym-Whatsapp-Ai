import { describe, expect, it } from "vitest";
import { suggestExercises } from "../../../apps/web/server/exercise-suggestions.js";
import type { StructuredOutputClient } from "../../../packages/ai/src/interfaces.js";

const exercises = [{ id: "bench", displayName: "Bench Press", aliases: [], custom: false, version: 1, defaultLoadSemantics: "TOTAL_LOAD" }];
const client = (rawJson: unknown): StructuredOutputClient => ({ createStructuredOutput: async () => ({ rawJson, model: "test" }) });
describe("exercise suggestions", () => {
  it("returns only known IDs and offers new names for confirmation", async () => {
    expect(await suggestExercises("chest", exercises, client({ ids: ["bench", "bad", "bench"], names: [" Bench Press ", "Incline Press", ""] }))).toEqual({ ids: ["bench"], names: ["Incline Press"], ai: true });
  });
  it("rejects malformed provider output", async () => {
    await expect(suggestExercises("chest", exercises, client({ ids: [] }))).rejects.toThrow();
  });
});
