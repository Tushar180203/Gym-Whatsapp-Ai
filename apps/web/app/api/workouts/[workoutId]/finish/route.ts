import { z } from "zod";
import { productionApp } from "../../../../../server/app.js";
import { readJsonBody, apiResponse, requestSession } from "../../../../../server/http.js";
const inputSchema = z.object({ requestedCompletion: z.enum(["COMPLETE", "INCOMPLETE", "CONTINUE", "DISCARD"]).optional(), idempotencyKey: z.string().min(1).max(200) }).strict();
export async function POST(request: Request, context: { params: Promise<{ workoutId: string }> }) {
  return apiResponse(request, async () => {
    const input = inputSchema.parse(await readJsonBody(request));
    return productionApp().workoutLifecycle({ sessionToken: requestSession(request), workoutId: (await context.params).workoutId,
      intent: input.requestedCompletion ?? "REQUEST", idempotencyKey: input.idempotencyKey });
  });
}
