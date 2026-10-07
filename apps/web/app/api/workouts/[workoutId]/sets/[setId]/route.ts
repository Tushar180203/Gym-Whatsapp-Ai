import { z } from "zod";
import { productionApp } from "../../../../../../server/app.js";
import { apiResponse, requestSession } from "../../../../../../server/http.js";
import { SetInputSchema } from "../../../../../../../../packages/contracts/src/ai/actions.js";
const edit = z.object({ replacement: SetInputSchema, idempotencyKey: z.string().min(1).max(100), expectedVersion: z.number().int().positive() }).strict();
export async function PATCH(request: Request, context: { params: Promise<{ workoutId: string; setId: string }> }) {
  return apiResponse(request, async () => {
    const input = edit.parse(await request.json()), params = await context.params;
    const body = await productionApp().editHistorySet({ sessionToken: requestSession(request), ...params, ...input, replacement: input.replacement as Parameters<ReturnType<typeof productionApp>["editHistorySet"]>[0]["replacement"] });
    return { body, history: await productionApp().historyDetails(requestSession(request), params.workoutId) };
  });
}
export function DELETE(request: Request, context: { params: Promise<{ workoutId: string; setId: string }> }) {
  return apiResponse(request, async () => { const { workoutId, setId } = await context.params; return productionApp().deleteWebSet(requestSession(request), workoutId, setId, await request.json()); });
}
