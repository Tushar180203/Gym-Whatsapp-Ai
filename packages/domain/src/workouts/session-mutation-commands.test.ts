import { expect, it } from "vitest";
import { reorderedIds, scopePolicy } from "./session-mutation-commands.js";
import { resolveExerciseIdentity } from "../exercises/unknown-exercise-flow.js";
import { routineChangePolicy } from "../routines/routine-change-request-service.js";
it("session/permanent/ambiguous scope has deterministic policy", () => {
  expect(scopePolicy("SESSION_ONLY")).toBe("SESSION");
  expect(scopePolicy("PERMANENT_ROUTINE")).toBe("CONFIRM");
  expect(scopePolicy("AMBIGUOUS")).toBe("CLARIFY");
  expect(reorderedIds(["a", "b", "c"], "c", 1)).toEqual(["c", "a", "b"]);
  expect(routineChangePolicy({ operation: "REMOVE_EXERCISE", sessionRef: "Upper", exerciseRef: "bench" }, "PERMANENT_ROUTINE")).toBe("CONFIRM");
});
it("unknown and conflicting aliases never resolve by similarity", () => {
  const identities = [{ id: "a", name: "Incline Dumbbell Press" }, { id: "b", name: "Smith Incline Press" }];
  expect(resolveExerciseIdentity("incline", identities, []).status).toBe("UNKNOWN");
  expect(resolveExerciseIdentity("incline", identities, [{ alias: "incline", identityId: "a" }])).toEqual({ status: "KNOWN", id: "a" });
  expect(resolveExerciseIdentity("incline", identities, [{ alias: "incline", identityId: "a" }, { alias: "incline", identityId: "b" }]).status).toBe("CONFLICT");
});
