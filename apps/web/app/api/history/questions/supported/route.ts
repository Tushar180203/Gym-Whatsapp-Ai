import { productionApp } from "../../../../../server/app.js";
import { apiResponse, requestSession } from "../../../../../server/http.js";
export async function GET(request: Request) {
  return apiResponse(request, async () => {
    await productionApp().currentUser(requestSession(request));
    return { queries: ["LAST_SESSION", "LAST_EXERCISE", "BEST_SET", "WEEKLY_PRIMARY_MUSCLE_SETS", "LAST_TRAINED", "MONTHLY_WORKOUT_COUNT"], calendar: "UTC" };
  });
}
