import { productionApp } from "../../../../server/app.js";

import { apiResponse, requestSession } from "../../../../server/http.js";
export async function POST(request: Request) {
  return apiResponse(request, async () => { const app = productionApp(); return app.startNextWorkout(await app.currentUser(requestSession(request))); });
}
