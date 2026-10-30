import { productionApp } from "./app.js";
import { apiResponse, requestSession } from "./http.js";
import type { Configuration } from "../../../packages/persistence/src/configuration.js";
import { whatsappTransport } from "./whatsapp/transport.js";
import { observe } from "./observability.js";

export function configurationResponse(request: Request, handler: (configuration: Configuration) => Promise<unknown>) {
  return apiResponse(request, async () => {
    const result = await productionApp().configure(requestSession(request), handler);
    if (["POST", "PATCH"].includes(request.method) && new URL(request.url).pathname.startsWith("/api/routines")) {
      try {
        const transport = whatsappTransport();
        if (transport) await transport.delivery.notificationsForUser(await productionApp().currentUser(requestSession(request)));
      } catch { observe({ event: "outbound_failure", code: "NOTIFICATION_DISPATCH_FAILED" }); }
    }
    return result;
  });
}
