import { configurationResponse } from "../../../server/configuration.js";
export function GET(request: Request) { return configurationResponse(request, c => c.routines()); }
export function POST(request: Request) { return configurationResponse(request, async c => c.saveRoutine(await request.json())); }
