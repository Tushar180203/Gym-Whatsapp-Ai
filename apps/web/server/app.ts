import { AuthService, InboundMessageProcessor, LinkService, ProfileService, RoutineService, WorkoutService } from "../../../packages/domain/src/index.js";
import { InMemoryStore, PostgresVerticalSliceApp } from "../../../packages/persistence/src/index.js";

export const inMemoryStore = new InMemoryStore();
export const authService = new AuthService(inMemoryStore);
export const profileService = new ProfileService(inMemoryStore);
export const routineService = new RoutineService(inMemoryStore);
export const linkService = new LinkService(inMemoryStore);
export const inboundMessageProcessor = new InboundMessageProcessor(inMemoryStore);
export const workoutService = new WorkoutService(inMemoryStore);

let postgresApp: PostgresVerticalSliceApp | null = null;

export function productionApp(): PostgresVerticalSliceApp {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the production PostgreSQL persistence path");
  }
  postgresApp ??= new PostgresVerticalSliceApp({ connectionString });
  return postgresApp;
}
