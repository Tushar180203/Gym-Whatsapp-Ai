import { productionApp } from "../../../../../server/app.js";
import { apiResponse, requestSession } from "../../../../../server/http.js";
export async function PATCH(request: Request, context: { params: Promise<{ exerciseId: string }> }) {
  return apiResponse(request, async () => { await productionApp().classifyExercise(requestSession(request), (await context.params).exerciseId, await request.json()); return { ok: true }; });
}
