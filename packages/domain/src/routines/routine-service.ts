import type { CreateRoutineRequest } from "../../../contracts/src/index.js";
import { DomainError, InMemoryStore } from "../../../persistence/src/index.js";

export class RoutineService {
  constructor(private readonly store: InMemoryStore) {}

  createRoutine(userId: string, input: CreateRoutineRequest) {
    if (input.sessions.length === 0) {
      throw new DomainError("Routine needs at least one session", "ROUTINE_EMPTY");
    }

    const routine = {
      id: this.store.nextId("routine"),
      userId,
      name: input.name,
      createdAt: this.store.now()
    };
    this.store.routines.set(routine.id, routine);

    input.sessions.forEach((session, sessionIndex) => {
      const template = {
        id: this.store.nextId("template"),
        routineId: routine.id,
        name: session.name,
        sequenceIndex: sessionIndex
      };
      this.store.templates.set(template.id, template);

      session.exercises.forEach((exerciseInput, orderIndex) => {
        if (exerciseInput.plannedSetCount <= 0) {
          throw new DomainError("Planned set count must be positive", "INVALID_PLANNED_SET_COUNT");
        }
        const exercise = {
          id: this.store.nextId("exercise"),
          ownerUserId: userId,
          displayName: exerciseInput.exerciseName,
          defaultLoadSemantics: exerciseInput.defaultLoadSemantics ?? "UNSPECIFIED_DEFAULT",
          archivedAt: null
        };
        this.store.exercises.set(exercise.id, exercise);
        const plannedId = this.store.nextId("planned");
        this.store.plannedExercises.set(plannedId, {
          id: plannedId,
          sessionTemplateId: template.id,
          exerciseIdentityId: exercise.id,
          orderIndex,
          plannedSetCount: exerciseInput.plannedSetCount,
          repTargetMin: exerciseInput.repTargetMin,
          repTargetMax: exerciseInput.repTargetMax ?? exerciseInput.repTargetMin
        });
      });
    });

    const firstTemplate = [...this.store.templates.values()].find(
      (template) => template.routineId === routine.id && template.sequenceIndex === 0
    );
    if (!firstTemplate) throw new DomainError("Routine needs a template", "ROUTINE_EMPTY");

    const cursorId = this.store.nextId("cursor");
    this.store.cursors.set(cursorId, {
      id: cursorId,
      routineId: routine.id,
      userId,
      nextSessionTemplateId: firstTemplate.id,
      cursorSequenceIndex: 0
    });

    return routine;
  }
}
