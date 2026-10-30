import { z } from "zod";
import { readJsonBody, apiResponse, requestSession } from "../../../../server/http.js";
import { productionApp } from "../../../../server/app.js";
import { reviewAnalytics } from "../../../../server/analytics-insights.js";
import { observe } from "../../../../server/observability.js";
const inputSchema = z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
}) }).strict();
export function POST(request: Request) {
  return apiResponse(request, async () => {
    const data = await productionApp().analytics(requestSession(request));
    const { week } = inputSchema.parse(await readJsonBody(request));
    try { return await reviewAnalytics(data, week); }
    catch {
      observe({ event: "domain_failure", code: "ANALYTICS_REVIEW_UNAVAILABLE" });
      return { available: false, mappings: [], highlightIds: [] };
    }
  });
}
