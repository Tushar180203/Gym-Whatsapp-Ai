import { readJsonBody } from "../../../../server/http.js";
import { configurationResponse } from "../../../../server/configuration.js";
export function PATCH(request: Request, context: { params: Promise<{ exerciseId: string }> }) {
  return configurationResponse(request, async c => c.rename((await context.params).exerciseId, await readJsonBody(request)));
}
