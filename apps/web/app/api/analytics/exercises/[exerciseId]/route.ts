import { productionApp } from "../../../../../server/app.js";
import { apiResponse, requestSession } from "../../../../../server/http.js";
export async function GET(request: Request, context: { params: Promise<{ exerciseId: string }> }) {
  return apiResponse(request, async () => productionApp().exerciseAnalytics(requestSession(request), (await context.params).exerciseId));
}
