import { configurationResponse } from "../../../../../server/configuration.js";
export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return configurationResponse(request, async c => c.revokeLink((await context.params).id));
}
