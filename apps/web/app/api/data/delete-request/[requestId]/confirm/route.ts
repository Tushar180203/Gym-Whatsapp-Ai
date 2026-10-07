import { productionApp } from "../../../../../../server/app.js";
import { apiResponse, requestSession } from "../../../../../../server/http.js";
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await context.params;
  return apiResponse(request, async () => productionApp().confirmDeletion(requestSession(request), requestId, await request.json()));
}
