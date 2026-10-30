import type {
  CommandExecutionStatus,
  InboundProcessingStatus,
  LoadSemantics,
  OutboundDeliveryStatus,
  RoutineSequenceProgressionPolicy,
  SessionExerciseStatus,
  SetStatus,
  WeightUnit,
  WorkoutSessionStatus
} from "../../contracts/src/index.js";

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  deletedAt: Date | null;
  createdAt: Date;
};

export type UserProfile = {
  id: string;
  userId: string;
  preferredWeightUnit: WeightUnit;
  displayName: string | null;
};

export type AuthSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  invalidatedAt: Date | null;
  createdAt: Date;
};

export type WhatsAppProviderAccount = {
  id: string;
  provider: "WHATSAPP_CLOUD_API";
  providerAccountId: string;
};

export type WhatsAppProviderUserIdentity = {
  id: string;
  whatsAppProviderAccountId: string;
  providerUserIdentityHash: string;
  createdAt: Date;
};

export type WhatsAppIdentityLink = {
  id: string;
  userId: string;
  whatsAppProviderUserIdentityId: string;
  linkedAt: Date;
  revokedAt: Date | null;
};

export type AccountLinkToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

export type ExerciseIdentity = {
  id: string;
  ownerUserId: string | null;
  displayName: string;
  defaultLoadSemantics: LoadSemantics;
  archivedAt: Date | null;
};

export type Routine = {
  id: string;
  userId: string;
  name: string;
  createdAt: Date;
};

export type WorkoutSessionTemplate = {
  id: string;
  routineId: string;
  name: string;
  sequenceIndex: number;
};

export type PlannedExercise = {
  id: string;
  sessionTemplateId: string;
  exerciseIdentityId: string;
  orderIndex: number;
  plannedSetCount: number;
  repTargetMin: number;
  repTargetMax: number;
};

export type RoutineSequenceCursor = {
  id: string;
  routineId: string;
  userId: string;
  nextSessionTemplateId: string;
  cursorSequenceIndex: number;
};

export type WorkoutSession = {
  id: string;
  userId: string;
  routineId: string;
  sessionTemplateId: string;
  templateSnapshot: unknown;
  name: string;
  status: WorkoutSessionStatus;
  activeSessionExerciseId: string | null;
  sequenceProgressionPolicy: RoutineSequenceProgressionPolicy;
  startedAt: Date | null;
  completedAt: Date | null;
  discardedAt: Date | null;
  durationSeconds: number | null;
  completionIntent: "COMPLETE" | "INCOMPLETE" | "DISCARD" | null;
  version: number;
  createdAt: Date;
};

export type SessionExercise = {
  id: string;
  workoutSessionId: string;
  exerciseIdentityId: string;
  sourcePlannedExerciseId: string | null;
  orderIndex: number;
  status: SessionExerciseStatus;
  plannedSetCountSnapshot: number;
  repTargetMinSnapshot: number;
  repTargetMaxSnapshot: number;
};

export type WorkoutSet = {
  id: string;
  userId: string;
  workoutSessionId: string;
  sessionExerciseId: string;
  exerciseIdentityId: string;
  setIndex: number;
  loadValue: number;
  weightUnit: WeightUnit;
  loadSemantics: LoadSemantics;
  reps: number;
  status: SetStatus;
  idempotencyKey: string;
  sourceMessageId: string | null;
  createdAt: Date;
};

export type InboundMessage = {
  id: string;
  provider: "WHATSAPP_CLOUD_API";
  providerMessageId: string;
  providerAccountId: string;
  providerUserIdentityHash: string;
  userId: string | null;
  text: string;
  rawPayloadHash: string;
  processingStatus: InboundProcessingStatus;
  commandExecutionId: string | null;
  outboundMessageId: string | null;
  processedAt: Date | null;
  errorCategory: string | null;
};

export type CommandExecution = {
  id: string;
  userId: string;
  commandType: string;
  idempotencyKey: string;
  status: CommandExecutionStatus;
  resultSummary: unknown;
  appliedAt: Date | null;
};

export type OutboundMessage = {
  id: string;
  userId: string;
  inboundMessageId: string;
  providerAccountId: string;
  providerUserIdentityHash: string;
  bodyHash: string;
  body: string;
  status: OutboundDeliveryStatus;
  sentAt: Date | null;
};
