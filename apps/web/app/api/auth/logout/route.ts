import { productionApp } from "../../../../server/app.js";

import { apiResponse, requestSession, sessionCookie } from "../../../../server/http.js";
export async function POST(request: Request) {
  const response = await apiResponse(request, async () => {
    await productionApp().logout(requestSession(request)); return { ok: true };
  });
  response.headers.set("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  return response;
}
