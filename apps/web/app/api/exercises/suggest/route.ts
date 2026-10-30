import { apiResponse, requestSession } from "../../../../server/http.js";
import { productionApp } from "../../../../server/app.js";
import { suggestExercises } from "../../../../server/exercise-suggestions.js";
import { observe } from "../../../../server/observability.js";
import { AiProviderError } from "../../../../../../packages/ai/src/interfaces.js";

export function GET(request: Request) {
  return apiResponse(request, async () => {
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";
    const exercises = await productionApp().configure(requestSession(request), configuration => configuration.exercises());
    if (query.length < 2) return { ids: [], names: [], ai: false };
    try { return await suggestExercises(query, exercises); }
    catch (error) {
      observe({ event: "domain_failure", code: error instanceof AiProviderError ? error.code : "EXERCISE_SUGGESTIONS_FAILED" });
      return { ids: [], names: [], ai: false };
    }
  });
}
