import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "../../../packages/persistence/src/store.js";
const mocks = vi.hoisted(() => ({ analytics: vi.fn(), review: vi.fn() }));
vi.mock("../../../apps/web/server/app.js", () => ({ productionApp: () => ({ analytics: mocks.analytics }) }));
vi.mock("../../../apps/web/server/analytics-insights.js", () => ({ reviewAnalytics: mocks.review }));
import { POST } from "../../../apps/web/app/api/analytics/insights/route.js";
const request = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/analytics/insights", { method: "POST", headers: { "content-type": "application/json", cookie: "workout_session=owner-session", origin }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.analytics.mockResolvedValue({ owner: "authenticated" }); mocks.review.mockResolvedValue({ available: true, mappings: [], highlightIds: [] }); });
describe("analytics review endpoint", () => {
  it("authenticates before invoking AI", async () => {
    mocks.analytics.mockRejectedValue(new DomainError("Unauthenticated", "UNAUTHENTICATED"));
    expect((await POST(request({ week: "2026-10-26" }))).status).toBe(401);
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests", async () => {
    expect((await POST(request({ week: "2026-10-26" }, "https://foreign.example"))).status).toBe(403);
    expect(mocks.analytics).not.toHaveBeenCalled();
  });
  it.each(["2026-10-27", "2026-02-30", "bad-date"])("rejects invalid week %s", async week => {
    expect((await POST(request({ week }))).status).toBe(400); expect(mocks.review).not.toHaveBeenCalled();
  });
  it("uses only the authenticated snapshot and does not cache private results", async () => {
    const response = await POST(request({ week: "2026-10-26" }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.analytics).toHaveBeenCalledWith("owner-session");
    expect(mocks.review).toHaveBeenCalledWith({ owner: "authenticated" }, "2026-10-26");
  });
  it("falls back honestly when the provider fails", async () => {
    mocks.review.mockRejectedValue(new Error("private provider details"));
    const response = await POST(request({ week: "2026-10-26" }));
    expect(await response.json()).toEqual({ available: false, mappings: [], highlightIds: [] });
  });
});
