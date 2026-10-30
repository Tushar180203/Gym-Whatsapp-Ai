import { productionApp } from "../../../../../server/app.js";
import { readJsonBody, apiResponse, requestSession } from "../../../../../server/http.js";
export function POST(request: Request, context: { params: Promise<{ workoutId: string }> }) {
  return apiResponse(request, async () => productionApp().recordWebSets(requestSession(request), (await context.params).workoutId, await readJsonBody(request)));
}
