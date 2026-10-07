import { PostgresVerticalSliceApp } from "../../../packages/persistence/src/index.js";
import { createStructuredOutputClient, StaticPromptRegistry, StructuredIntentInterpreter } from "../../../packages/ai/src/index.js";
import { runtimeEnv } from "../../../packages/contracts/src/env.js";
import { RateLimitService } from "../../../packages/domain/src/rate-limit/rate-limit-service.js";
import { observe } from "./observability.js";
const inboundLimit = new RateLimitService(120);
const aiLimit = new RateLimitService(20);

let postgresApp: PostgresVerticalSliceApp | null = null;

export function productionApp(): PostgresVerticalSliceApp {
  const { DATABASE_URL: connectionString } = runtimeEnv();
  postgresApp ??= new PostgresVerticalSliceApp({
    connectionString,
    interpreter: new StructuredIntentInterpreter(createStructuredOutputClient(), new StaticPromptRegistry()),
    observe,
    checkInboundLimit: key => inboundLimit.check(key),
    checkAiLimit: key => aiLimit.check(key)
  });
  return postgresApp;
}
