import { productionApp } from "../../../../server/app.js";

import { apiResponse, requestSession } from "../../../../server/http.js";
export async function POST(request: Request) {
  return apiResponse(request, async () => { const app = productionApp(); return { token: await app.createLinkToken(await app.currentUser(requestSession(request))) }; });
}
