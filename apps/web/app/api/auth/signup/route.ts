import { productionApp } from "../../../../server/app.js";

import { z } from "zod";
import { apiResponse, sessionCookie } from "../../../../server/http.js";
export async function POST(request: Request) {
  const response = await apiResponse(request, async () => {
    const input = z.object({ email: z.email(), password: z.string().min(12) }).strict().parse(await request.json());
    return productionApp().signUp(input.email, input.password);
  });
  if (!response.ok) return response;
  const result = await response.json();
  return Response.json({ userId: result.userId }, { headers: { "Cache-Control": "no-store", "Set-Cookie": `${sessionCookie}=${result.sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}` } });
}
