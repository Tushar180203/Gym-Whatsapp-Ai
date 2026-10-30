import { productionApp } from "../../../../server/app.js";

import { loginRequestSchema } from "../../../../../../packages/contracts/src/api/requests.js";
import { readJsonBody, apiResponse, sessionCookie } from "../../../../server/http.js";
import { limitAuthAttempt } from "../../../../server/rate-limit.js";
export async function POST(request: Request) {
  const response = await apiResponse(request, async () => {
    const input = loginRequestSchema.parse(await readJsonBody(request));
    limitAuthAttempt(input.email);
    return productionApp().signIn(input.email, input.password);
  });
  if (!response.ok) return response;
  const result = await response.json();
  return Response.json({ userId: result.userId }, { headers: { "Cache-Control": "no-store", "Set-Cookie": `${sessionCookie}=${result.sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}` } });
}
