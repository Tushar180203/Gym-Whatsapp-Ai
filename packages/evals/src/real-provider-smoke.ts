import { createStructuredOutputClient, StaticPromptRegistry, StructuredIntentInterpreter } from "../../ai/src/index.js";
import { parseProposedActionEnvelope } from "../../contracts/src/index.js";

export async function runRealProviderSmoke(): Promise<void> {
  if (process.env.RUN_REAL_PROVIDER_EVAL !== "1") {
    console.log("Skipping real-provider smoke eval. Set RUN_REAL_PROVIDER_EVAL=1 to opt in.");
    return;
  }
  const interpreter = new StructuredIntentInterpreter(
    createStructuredOutputClient(),
    new StaticPromptRegistry(process.env.AI_MODEL)
  );
  const result = await interpreter.interpret({
    userInput: "45x10",
    idempotencyKey: "real-provider-smoke",
    context: {
      userId: "smoke-user",
      activeWorkout: true,
      activeExercise: "Bench Press",
      preferredWeightUnit: "KG"
    }
  });
  const validated = parseProposedActionEnvelope(result);
  if (validated.action.type !== "LOG_SET" || validated.action.set.loadValue !== 45 || validated.action.set.reps !== 10) {
    throw new Error("Real-provider smoke did not extract the expected set");
  }
  console.log(JSON.stringify({ ok: true, actionType: result.action.type, confidence: result.confidence }, null, 2));
}
