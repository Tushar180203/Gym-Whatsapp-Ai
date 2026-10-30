import { productionApp } from "../../../../server/app.js";
import { readJsonBody, apiResponse, requestSession } from "../../../../server/http.js";
export async function GET(request: Request, context: { params: Promise<{ workoutId: string }> }) {
  return apiResponse(request, async () => productionApp().historyDetails(requestSession(request), (await context.params).workoutId));
}
export async function PATCH(request: Request, context: { params: Promise<{ workoutId: string }> }) {
  return apiResponse(request, async () => productionApp().selectWorkout(requestSession(request), { ...await readJsonBody(request), workoutId: (await context.params).workoutId }));
}
