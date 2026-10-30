import { productionApp } from "../../../server/app.js";
import { readJsonBody, apiResponse, requestSession } from "../../../server/http.js";

export async function PATCH(request: Request) {
  return apiResponse(request, async () => {
    const input = await readJsonBody(request);
    return productionApp().configure(requestSession(request), configuration => configuration.profile(input));
  });
}

export async function GET(request: Request) {
  return apiResponse(request, async () => { const app = productionApp(); return app.profile(await app.currentUser(requestSession(request))); });
}
