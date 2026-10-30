import { readJsonBody } from "../../../../../server/http.js";
import { configurationResponse } from "../../../../../server/configuration.js";
export function POST(request: Request, context: { params: Promise<{ exerciseId: string }> }) {
  return configurationResponse(request, async c => c.alias((await context.params).exerciseId, await readJsonBody(request)));
}
