import type { LoadSemantics, WeightUnit } from "../../../contracts/src/index.js";
import {
  DomainError,
  InMemoryStore,
  type SessionExercise,
  type WorkoutSession,
  type WorkoutSet
} from "../../../persistence/src/index.js";
import { parseSetMessage } from "../parser/set-parser.js";

export class WorkoutService {
  constructor(private readonly store: InMemoryStore) {}

  async startNextWorkout(userId: string): Promise<WorkoutSession> {
    return this.store.withUserLock(userId, async () => {
      const active = this.store.activeWorkoutForUser(userId);
      if (active) return active;
      const cursor = [...this.store.cursors.values()].find((item) => item.userId === userId);
      if (!cursor) throw new DomainError("No routine sequence cursor", "NO_ROUTINE");
      const template = this.store.templates.get(cursor.nextSessionTemplateId);
      if (!template) throw new DomainError("Routine template missing", "NO_TEMPLATE");
      const planned = [...this.store.plannedExercises.values()]
        .filter((item) => item.sessionTemplateId === template.id)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      if (planned.length === 0) throw new DomainError("No planned exercises", "NO_EXERCISES");

      const workout: WorkoutSession = {
        id: this.store.nextId("workout"),
        userId,
        routineId: template.routineId,
        sessionTemplateId: template.id,
        templateSnapshot: {
          name: template.name,
          exercises: planned.map((item) => ({ ...item }))
        },
        name: template.name,
        status: "ACTIVE",
        activeSessionExerciseId: null,
        sequenceProgressionPolicy: "ADVANCE_NORMAL_SEQUENCE",
        startedAt: this.store.now(),
        completedAt: null,
        discardedAt: null,
        durationSeconds: null,
        completionIntent: null,
        version: 1,
        createdAt: this.store.now()
      };
      this.store.workouts.set(workout.id, workout);

      for (const plannedExercise of planned) {
        const sessionExercise: SessionExercise = {
          id: this.store.nextId("sexercise"),
          workoutSessionId: workout.id,
          exerciseIdentityId: plannedExercise.exerciseIdentityId,
          sourcePlannedExerciseId: plannedExercise.id,
          orderIndex: plannedExercise.orderIndex,
          status: plannedExercise.orderIndex === 0 ? "ACTIVE" : "PLANNED",
          plannedSetCountSnapshot: plannedExercise.plannedSetCount,
          repTargetMinSnapshot: plannedExercise.repTargetMin,
          repTargetMaxSnapshot: plannedExercise.repTargetMax
        };
        this.store.sessionExercises.set(sessionExercise.id, sessionExercise);
        if (plannedExercise.orderIndex === 0) {
          workout.activeSessionExerciseId = sessionExercise.id;
        }
      }
      return workout;
    });
  }

  async logSetMessage(params: {
    userId: string;
    messageText: string;
    idempotencyKey: string;
    sourceMessageId?: string;
  }): Promise<WorkoutSet[]> {
    return this.store.withUserLock(params.userId, async () => {
      const existingCommand = this.store.findCommand(params.userId, params.idempotencyKey);
      if (existingCommand?.status === "COMPLETED") {
        const ids = existingCommand.resultSummary as string[];
        return ids.map((id) => this.requiredSet(id));
      }

      const workout = this.requireActiveWorkout(params.userId);
      const activeExercise = this.requireActiveSessionExercise(workout);
      const exercise = this.store.exercises.get(activeExercise.exerciseIdentityId);
      if (!exercise) throw new DomainError("Exercise missing", "EXERCISE_MISSING");
      const profile = this.store.getProfileByUserId(params.userId);
      if (!profile) throw new DomainError("Profile missing", "PROFILE_REQUIRED");

      const previous = this.lastSetForSessionExercise(activeExercise.id);
      const parseOptions = {
        preferredWeightUnit: profile.preferredWeightUnit,
        exerciseDefaultLoadSemantics: exercise.defaultLoadSemantics
      };
      const parsed = parseSetMessage(
        params.messageText,
        previous
          ? {
              ...parseOptions,
              previousSet: {
                loadValue: previous.loadValue,
                weightUnit: previous.weightUnit,
                loadSemantics: previous.loadSemantics
              }
            }
          : parseOptions
      );

      const command = this.store.createCommand(params.userId, "LOG_SET", params.idempotencyKey);
      if (command.status === "COMPLETED") {
        return (command.resultSummary as string[]).map((id) => this.requiredSet(id));
      }

      const created: WorkoutSet[] = [];
      for (const parsedSet of parsed) {
        const setIndex =
          [...this.store.sets.values()].filter(
            (set) => set.sessionExerciseId === activeExercise.id && set.status === "RECORDED"
          ).length + 1;
        const set: WorkoutSet = {
          id: this.store.nextId("set"),
          userId: params.userId,
          workoutSessionId: workout.id,
          sessionExerciseId: activeExercise.id,
          exerciseIdentityId: activeExercise.exerciseIdentityId,
          setIndex,
          loadValue: parsedSet.loadValue,
          weightUnit: parsedSet.weightUnit as WeightUnit,
          loadSemantics: parsedSet.loadSemantics as LoadSemantics,
          reps: parsedSet.reps,
          status: "RECORDED",
          idempotencyKey: `${params.idempotencyKey}:${setIndex}`,
          sourceMessageId: params.sourceMessageId ?? null,
          createdAt: this.store.now()
        };
        this.store.sets.set(set.id, set);
        created.push(set);
      }
      activeExercise.status = "IN_PROGRESS";
      workout.version += 1;
      command.status = "COMPLETED";
      command.appliedAt = this.store.now();
      command.resultSummary = created.map((set) => set.id);
      return created;
    });
  }

  async finishWorkout(userId: string, intent: "COMPLETE" | "INCOMPLETE" = "COMPLETE") {
    return this.store.withUserLock(userId, async () => {
      const workout = this.requireActiveWorkout(userId);
      const sets = [...this.store.sets.values()].filter(
        (set) => set.workoutSessionId === workout.id && set.status === "RECORDED"
      );
      if (sets.length === 0 && intent === "COMPLETE") {
        throw new DomainError("Cannot complete empty workout without explicit incomplete intent", "EMPTY_WORKOUT");
      }
      workout.status = intent === "COMPLETE" ? "COMPLETED" : "INCOMPLETE";
      workout.completionIntent = intent;
      workout.completedAt = this.store.now();
      workout.activeSessionExerciseId = null;
      workout.durationSeconds = workout.startedAt
        ? Math.max(0, Math.floor((workout.completedAt.getTime() - workout.startedAt.getTime()) / 1000))
        : null;
      workout.version += 1;
      if (workout.status === "COMPLETED" && workout.sequenceProgressionPolicy === "ADVANCE_NORMAL_SEQUENCE") {
        this.advanceCursor(workout);
      }
      return workout;
    });
  }

  workoutHistory(userId: string) {
    return [...this.store.workouts.values()]
      .filter((workout) => workout.userId === userId && ["COMPLETED", "INCOMPLETE"].includes(workout.status))
      .map((workout) => ({
        workout,
        sets: [...this.store.sets.values()].filter((set) => set.workoutSessionId === workout.id)
      }));
  }

  private requireActiveWorkout(userId: string): WorkoutSession {
    const workout = this.store.activeWorkoutForUser(userId);
    if (!workout) throw new DomainError("No active workout", "NO_ACTIVE_WORKOUT");
    return workout;
  }

  private requireActiveSessionExercise(workout: WorkoutSession): SessionExercise {
    if (!workout.activeSessionExerciseId) {
      throw new DomainError("No active exercise", "NO_ACTIVE_EXERCISE");
    }
    const sessionExercise = this.store.sessionExercises.get(workout.activeSessionExerciseId);
    if (!sessionExercise) throw new DomainError("Active exercise missing", "NO_ACTIVE_EXERCISE");
    return sessionExercise;
  }

  private lastSetForSessionExercise(sessionExerciseId: string): WorkoutSet | undefined {
    return [...this.store.sets.values()]
      .filter((set) => set.sessionExerciseId === sessionExerciseId && set.status === "RECORDED")
      .sort((a, b) => b.setIndex - a.setIndex)[0];
  }

  private requiredSet(id: string): WorkoutSet {
    const set = this.store.sets.get(id);
    if (!set) throw new DomainError("Set missing", "SET_MISSING");
    return set;
  }

  private advanceCursor(workout: WorkoutSession): void {
    const cursor = [...this.store.cursors.values()].find((item) => item.routineId === workout.routineId);
    if (!cursor) return;
    const templates = [...this.store.templates.values()]
      .filter((template) => template.routineId === workout.routineId)
      .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
    const currentIndex = templates.findIndex((template) => template.id === workout.sessionTemplateId);
    const next = templates[(currentIndex + 1) % templates.length];
    if (next) {
      cursor.nextSessionTemplateId = next.id;
      cursor.cursorSequenceIndex = next.sequenceIndex;
    }
  }
}
