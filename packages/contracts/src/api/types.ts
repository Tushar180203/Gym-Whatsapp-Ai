import type { LoadSemantics, WeightUnit } from "../domain/enums.js";

export type SignupRequest = {
  email: string;
  password: string;
};

export type ProfilePatchRequest = {
  preferredWeightUnit: WeightUnit;
  displayName?: string;
};

export type CreateRoutineRequest = {
  name: string;
  sessions: Array<{
    name: string;
    exercises: Array<{
      exerciseName: string;
      plannedSetCount: number;
      repTargetMin: number;
      repTargetMax?: number;
      defaultLoadSemantics?: LoadSemantics;
    }>;
  }>;
};

export type NormalizedWhatsAppMessage = {
  provider: "WHATSAPP_CLOUD_API";
  providerAccountId: string;
  providerMessageId: string;
  providerUserIdentityHash: string;
  text: string;
  rawPayloadHash: string;
  providerSentAt?: number;
};
