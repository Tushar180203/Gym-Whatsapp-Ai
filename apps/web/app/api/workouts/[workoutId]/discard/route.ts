import { z } from "zod";
import { productionApp } from "../../../../../server/app.js";
import { apiResponse, requestSession } from "../../../../../server/http.js";
const inputSchema = z.object({ idempotencyKey: z.string().min(1).max(200) }).strict();
export async function POST(request: Request, context: { params: Promise<{ workoutId: string }> }) {
  return apiResponse(request, async () => {
    const input = inputSchema.parse(await request.json());
    return productionApp().workoutLifecycle({ sessionToken: requestSession(request), workoutId: (await context.params).workoutId,
      intent: "DISCARD", idempotencyKey: input.idempotencyKey });
  });
}
