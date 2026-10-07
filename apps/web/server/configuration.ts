import { productionApp } from "./app.js";
import { apiResponse, requestSession } from "./http.js";
import type { Configuration } from "../../../packages/persistence/src/configuration.js";

export function configurationResponse(request: Request, handler: (configuration: Configuration) => Promise<unknown>) {
  return apiResponse(request, () => productionApp().configure(requestSession(request), handler));
}
