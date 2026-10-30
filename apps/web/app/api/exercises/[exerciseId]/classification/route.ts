import { productionApp } from "../../../../../server/app.js";
import { readJsonBody, apiResponse, requestSession } from "../../../../../server/http.js";
export async function PATCH(request: Request, context: { params: Promise<{ exerciseId: string }> }) {
  return apiResponse(request, async () => { await productionApp().classifyExercise(requestSession(request), (await context.params).exerciseId, await readJsonBody(request)); return { ok: true }; });
}
