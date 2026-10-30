import { describe, expect, it } from "vitest";
import { localClock, localDate, localWeek, validTimeZone } from "../time/local-calendar.js";
import { memoryText } from "./memory.js";
import { parseRecallIntent } from "./recall-intent.js";
describe("local conversation memory", () => {
  it("resolves a different local day and Monday week across a UTC boundary", () => {
    const now = new Date("2026-10-04T19:00:00Z");
    expect(localClock(now, "Asia/Kolkata")).toMatchObject({ localDate: "2026-10-05", localTime: "00:30" });
    expect(localDate(now, "America/Los_Angeles")).toBe("2026-10-04");
    expect(localWeek(now, "Asia/Kolkata")).toBe("2026-10-05");
    expect(validTimeZone("invalid/zone")).toBe(false);
  });
  it("resolves yesterday and morning in the user's calendar", () => {
    expect(parseRecallIntent("what did I tell you yesterday morning?", new Date("2026-10-04T19:00:00Z"), "Asia/Kolkata")).toEqual({ type: "QUERY_CONVERSATION", onDate: "2026-10-04", period: "MORNING" });
    expect(parseRecallIntent("what did I say about bench yesterday?", new Date(), "UTC")).toBeUndefined();
    expect(parseRecallIntent("45x10", new Date(), "UTC")).toBeUndefined();
  });
  it("excludes verification credentials and bounds remembered text", () => {
    expect(memoryText("LINK secret-token")).toBeNull();
    expect(memoryText("my api_key=credential")).toBeNull();
    expect(memoryText("hello me@example.com +919876543210")).toBe("hello [email] [phone]");
    expect(memoryText("x".repeat(2000))).toHaveLength(1000);
  });
});
