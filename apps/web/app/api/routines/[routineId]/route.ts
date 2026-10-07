import { configurationResponse } from "../../../../server/configuration.js";
type Context = { params: Promise<{ routineId: string }> };
export function GET(request: Request, context: Context) { return configurationResponse(request, async c => c.routine((await context.params).routineId)); }
export function PATCH(request: Request, context: Context) { return configurationResponse(request, async c => c.saveRoutine(await request.json(), (await context.params).routineId)); }
export function DELETE(request: Request, context: Context) { return configurationResponse(request, async c => c.archiveRoutine((await context.params).routineId, await request.json())); }
