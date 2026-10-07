import { configurationResponse } from "../../../../server/configuration.js";
export function POST(request: Request) { return configurationResponse(request, async c => c.customExercise(await request.json())); }
