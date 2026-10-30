import { productionApp } from "../../../../../server/app.js";
import { apiResponse, requestSession } from "../../../../../server/http.js";
export async function POST(request: Request, context: { params: Promise<{ workoutId: string }> }) {
  return apiResponse(request, async () => productionApp().workoutLifecycle({
    sessionToken: requestSession(request), workoutId: (await context.params).workoutId,
    intent: "RESUME", idempotencyKey: "resume"
  }));
}
