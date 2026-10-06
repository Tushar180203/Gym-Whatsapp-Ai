import type { WeightUnit } from "../../../contracts/src/index.js";
import { DomainError, InMemoryStore } from "../../../persistence/src/index.js";

export class ProfileService {
  constructor(private readonly store: InMemoryStore) {}

  setPreferredWeightUnit(userId: string, preferredWeightUnit: WeightUnit, displayName?: string) {
    const existing = this.store.getProfileByUserId(userId);
    if (existing) {
      existing.preferredWeightUnit = preferredWeightUnit;
      existing.displayName = displayName ?? existing.displayName;
      return existing;
    }
    const profile = {
      id: this.store.nextId("profile"),
      userId,
      preferredWeightUnit,
      displayName: displayName ?? null
    };
    this.store.profiles.set(profile.id, profile);
    return profile;
  }

  getRequiredProfile(userId: string) {
    const profile = this.store.getProfileByUserId(userId);
    if (!profile) throw new DomainError("Profile is required", "PROFILE_REQUIRED");
    return profile;
  }
}
