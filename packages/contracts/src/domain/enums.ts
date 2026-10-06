export const weightUnits = ["KG", "LB"] as const;
export type WeightUnit = (typeof weightUnits)[number];

export const loadSemanticsValues = [
  "UNSPECIFIED_DEFAULT",
  "PER_HAND_PER_SIDE",
  "TOTAL_LOAD",
  "MACHINE_STACK"
] as const;
export type LoadSemantics = (typeof loadSemanticsValues)[number];

export type WorkoutSessionStatus =
  | "PROPOSED"
  | "ACTIVE"
  | "PAUSED"
  | "INCOMPLETE"
  | "COMPLETED"
  | "DISCARDED"
  | "CANCELLED_REPLACED";

export type SessionExerciseStatus =
  | "PLANNED"
  | "ACTIVE"
  | "IN_PROGRESS"
  | "SKIPPED"
  | "REPLACED"
  | "COMPLETED";

export type SetStatus = "RECORDED" | "DELETED";

export type InboundProcessingStatus =
  | "RECEIVED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL";

export type CommandExecutionStatus =
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL";

export type OutboundDeliveryStatus =
  | "PENDING"
  | "SENT"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL";

export type RoutineSequenceProgressionPolicy =
  | "ADVANCE_NORMAL_SEQUENCE"
  | "DO_NOT_ADVANCE_NORMAL_SEQUENCE"
  | "SET_CURSOR_EXPLICITLY";

export function assertWeightUnit(value: string): WeightUnit {
  if (value !== "KG" && value !== "LB") {
    throw new Error(`Unsupported weight unit: ${value}`);
  }
  return value;
}
