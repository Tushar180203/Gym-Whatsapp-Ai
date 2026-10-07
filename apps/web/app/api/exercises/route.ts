import { configurationResponse } from "../../../server/configuration.js";
export function GET(request: Request) { return configurationResponse(request, c => c.exercises()); }
