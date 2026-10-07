import { productionApp } from "../../../../server/app.js";

import { apiResponse, requestSession } from "../../../../server/http.js";
export async function POST(request: Request) {
  return apiResponse(request, async () => productionApp().selectWorkout(requestSession(request), await request.json()));
}
