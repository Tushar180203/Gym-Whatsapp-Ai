import { productionApp } from "../../../../server/app.js";

import { apiResponse, requestSession } from "../../../../server/http.js";
export async function GET(request: Request) {
  return apiResponse(request, async () => { const app = productionApp(); return app.history(await app.currentUser(requestSession(request))); });
}
