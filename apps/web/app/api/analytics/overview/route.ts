import { productionApp } from "../../../../server/app.js";
import { apiResponse, requestSession } from "../../../../server/http.js";
export async function GET(request: Request) {
  return apiResponse(request, async () => productionApp().analytics(requestSession(request)));
}
