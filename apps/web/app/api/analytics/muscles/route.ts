import { productionApp } from "../../../../server/app.js";
import { apiResponse, requestSession } from "../../../../server/http.js";
export async function GET(request: Request) {
  return apiResponse(request, async () => { const result = await productionApp().analytics(requestSession(request)); return { calendar: result.calendar, weekStarting: result.weekStarting, muscles: result.muscles }; });
}
