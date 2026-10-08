import { productionApp } from "../../../../server/app.js";

import { apiResponse, requestSession } from "../../../../server/http.js";
import { verificationDeepLink } from "../../../../../../packages/messaging/src/whatsapp/link-challenge.js";
export async function POST(request: Request) {
  return apiResponse(request, async () => {
    await productionApp().currentUser(requestSession(request));
    // Check public destination configuration before issuing a code; never accept a phone-number ID as addressing.
    verificationDeepLink(process.env.WHATSAPP_BUSINESS_NUMBER, "configuration-check");
    const result = await productionApp().createWebLinkToken(requestSession(request), await request.json());
    return { ...result, whatsappUrl: verificationDeepLink(process.env.WHATSAPP_BUSINESS_NUMBER, result.token) };
  });
}
