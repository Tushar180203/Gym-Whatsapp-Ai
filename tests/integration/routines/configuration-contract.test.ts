import { describe, expect, it } from "vitest";
import { aliasRequestSchema, customExerciseSchema, exerciseRenameSchema, profilePatchSchema, routineConfigurationSchema } from "../../../packages/contracts/src/api/configuration.js";
describe("authenticated configuration request contracts", () => {
  const routine = { name: "Rotation", schedule: { intendedWorkoutsPerWeek: 3, plannedDays: ["MON"] }, sessions: [{ name: "Upper", exercises: [{ exerciseIdentityId: "bench", plannedSetCount: 3, repTargetMin: 8, repTargetMax: 10 }] }] };
  it("accepts defined profile fields and rejects ignored fields or foreign owner claims", () => {
    expect(profilePatchSchema.parse({ preferredWeightUnit: "LB", displayName: "Sam" })).toEqual({ preferredWeightUnit: "LB", displayName: "Sam" });
    for (const field of ["userId", "password", "unexpected"]) expect(() => profilePatchSchema.parse({ preferredWeightUnit: "KG", [field]: "other" })).toThrow();
  });
  it("validates exact/range reps, positive sets, days, and unique existing session references", () => {
    expect(routineConfigurationSchema.parse(routine).sessions[0]!.exercises[0]).toMatchObject({ plannedSetCount: 3, repTargetMin: 8, repTargetMax: 10 });
    for (const exercise of [{ plannedSetCount: 0, repTargetMin: 8 }, { plannedSetCount: 3, repTargetMin: 10, repTargetMax: 8 }]) expect(() => routineConfigurationSchema.parse({ ...routine, sessions: [{ name: "Upper", exercises: [{ exerciseIdentityId: "bench", ...exercise }] }] })).toThrow();
    expect(() => routineConfigurationSchema.parse({ ...routine, userId: "other" })).toThrow();
    expect(() => routineConfigurationSchema.parse({ ...routine, sessions: [{ ...routine.sessions[0], id: "same" }, { ...routine.sessions[0], id: "same" }] })).toThrow();
  });
  it("requires explicit identity/alias confirmation; rename uses the same versioned identity", () => {
    expect(() => customExerciseSchema.parse({ name: "Red press", defaultLoadSemantics: "MACHINE_STACK" })).toThrow();
    expect(() => aliasRequestSchema.parse({ alias: "red", confirm: false })).toThrow();
    expect(exerciseRenameSchema.parse({ displayName: "Red incline", expectedVersion: 2 })).toEqual({ displayName: "Red incline", expectedVersion: 2 });
    expect(() => exerciseRenameSchema.parse({ displayName: "Other", expectedVersion: 2, exerciseIdentityId: "foreign" })).toThrow();
  });
});
