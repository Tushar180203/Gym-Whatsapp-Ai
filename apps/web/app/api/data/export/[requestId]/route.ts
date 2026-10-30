import { productionApp } from "../../../../../server/app.js";
import { apiResponse, requestSession } from "../../../../../server/http.js";
export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await context.params;
  const response = await apiResponse(request, () => productionApp().exportResult(requestSession(request), requestId));
  if (!response.ok || new URL(request.url).searchParams.get("download") !== "1") return response;
  const result = await response.json();
  if (!result.data) return Response.json({ error: "Export unavailable." }, { status: 410, headers: { "Cache-Control": "no-store" } });
  return Response.json(result.data, { headers: { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="workout-export.json"` } });
}
