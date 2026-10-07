import { productionApp } from "../../../server/app.js";
import { z } from "zod";
import { apiResponse, requestSession } from "../../../server/http.js";

export async function PATCH(request: Request) {
  return apiResponse(request, async () => {
    const app = productionApp(), userId = await app.currentUser(requestSession(request));
    const input = z.object({ preferredWeightUnit: z.enum(["KG", "LB"]), displayName: z.string().optional() }).strict().parse(await request.json());
    await app.setPreferredWeightUnit(userId, input.preferredWeightUnit); return app.profile(userId);
  });
}

export async function GET(request: Request) {
  return apiResponse(request, async () => { const app = productionApp(); return app.profile(await app.currentUser(requestSession(request))); });
}
