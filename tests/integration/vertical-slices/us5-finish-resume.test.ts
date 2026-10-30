import { describe, expect, it } from "vitest";
import { AuthService, ProfileService, RoutineService, WorkoutService } from "../../../packages/domain/src/index.js";
import { InMemoryStore } from "../../../packages/persistence/src/index.js";
describe("US5 finish/resume fast integration", () => {
  it("does not silently complete partial work and resumes the same context", async () => {
    const store = new InMemoryStore();
    const userId = new AuthService(store).signUp("us5-fast@example.com", "correct horse battery staple").user.id;
    new ProfileService(store).setPreferredWeightUnit(userId, "KG");
    new RoutineService(store).createRoutine(userId, { name: "Routine", sessions: [{ name: "Upper", exercises: [{ exerciseName: "Incline", plannedSetCount: 3, repTargetMin: 8 }] }] });
    const service = new WorkoutService(store);
    const workout = await service.startNextWorkout(userId), context = workout.activeSessionExerciseId;
    await service.logSetMessage({ userId, messageText: "45x10", idempotencyKey: "set-1" });
    await expect(service.finishWorkout(userId)).rejects.toMatchObject({ code: "COMPLETION_CHOICE_REQUIRED" });
    expect(service.workoutHistory(userId)).toHaveLength(0);
    expect((await service.resumeWorkout(userId)).id).toBe(workout.id);
    expect(workout.activeSessionExerciseId).toBe(context);
    await service.finishWorkout(userId, "INCOMPLETE");
    expect(service.workoutHistory(userId)[0]?.workout.status).toBe("INCOMPLETE");
    expect([...store.cursors.values()][0]?.cursorSequenceIndex).toBe(0);
  });
});
