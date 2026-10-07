import { z } from "zod";

const name = z.string().trim().min(1).max(120);
export const profilePatchSchema = z.object({
  preferredWeightUnit: z.enum(["KG", "LB"]),
  displayName: z.string().trim().max(120).nullable().optional()
}).strict();
export const plannedExerciseSchema = z.object({
  exerciseIdentityId: name,
  plannedSetCount: z.number().int().min(1).max(100),
  repTargetMin: z.number().int().min(1).max(1000),
  repTargetMax: z.number().int().min(1).max(1000).optional()
}).strict().refine(value => (value.repTargetMax ?? value.repTargetMin) >= value.repTargetMin, "Invalid rep range");
export const routineConfigurationSchema = z.object({
  name,
  expectedVersion: z.number().int().positive().optional(),
  confirmSequenceChange: z.literal(true).optional(),
  schedule: z.object({
    intendedWorkoutsPerWeek: z.number().int().min(1).max(14).optional(),
    plannedDays: z.array(z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"])).max(7).default([])
  }).strict().default({ plannedDays: [] }),
  sessions: z.array(z.object({
    id: name.optional(), name,
    exercises: z.array(plannedExerciseSchema).min(1).max(100)
  }).strict()).min(1).max(30)
}).strict().refine(value => new Set(value.sessions.filter(session => session.id).map(session => session.id)).size === value.sessions.filter(session => session.id).length, "Duplicate session IDs");
export type RoutineConfiguration = z.infer<typeof routineConfigurationSchema>;
export const customExerciseSchema = z.object({
  name, confirm: z.literal(true),
  defaultLoadSemantics: z.enum(["UNSPECIFIED_DEFAULT", "PER_HAND_PER_SIDE", "TOTAL_LOAD", "MACHINE_STACK"])
}).strict();
export const aliasRequestSchema = z.object({ alias: name, confirm: z.literal(true) }).strict();
export const exerciseRenameSchema = z.object({ displayName: name, expectedVersion: z.number().int().positive() }).strict();
