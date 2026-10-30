import { readJsonBody } from "../../../../server/http.js";
import { configurationResponse } from "../../../../server/configuration.js";
export function POST(request: Request) { return configurationResponse(request, async c => c.merge(await readJsonBody(request))); }
