import { describe, expect, it } from "vitest";
import { morningReminder, renderMorningReminder, type MorningReminderInput } from "./morning-reminder.js";
const base: MorningReminderInput = { enabled: true, timeZone: "Asia/Kolkata", now: new Date("2026-10-25T23:30:00Z"), hasActiveWorkout: false, trainedToday: false,
  routines: [{ name: "Upper / Lower", sessionName: "Push day", plannedDays: ["MON", "WED", "FRI"] }] };
describe("5 AM reminder planning", () => {
  it("uses the saved local day rather than UTC and names the persisted next session", () => {
    expect(morningReminder(base)).toMatchObject({ localDate: "2026-10-26", summary: "Upper / Lower: Push day", expiresAt: new Date("2026-10-25T23:45:00Z") });
    expect(morningReminder(base)?.body).toContain("Yeahh buddy, let's gooo! 💪🔥");
  });
  it.each(["2026-10-25T23:29:59Z", "2026-10-25T23:40:00Z", "2026-10-25T12:00:00Z"])("does not remind outside the catch-up window: %s", value => {
    expect(morningReminder({ ...base, now: new Date(value) })).toBeNull();
  });
  it("keeps the same 05:15 expiry throughout the catch-up window", () => {
    expect(morningReminder({ ...base, now: new Date("2026-10-25T23:39:59.500Z") })?.expiresAt).toEqual(new Date("2026-10-25T23:45:00Z"));
  });
  it.each([{ enabled: false }, { hasActiveWorkout: true }, { trainedToday: true }, { timeZone: "invalid/timezone" }, { routines: [] }, { routines: [{ ...base.routines[0]!, plannedDays: [] }] }])("does not fabricate a reminder for ineligible context", change => {
    expect(morningReminder({ ...base, ...change })).toBeNull();
  });
  it("respects daylight-saving changes at the saved local hour", () => {
    const sunday = { ...base, timeZone: "America/New_York", routines: [{ ...base.routines[0]!, plannedDays: ["SUN"] }] };
    expect(morningReminder({ ...sunday, now: new Date("2026-11-01T10:00:00Z") })?.localDate).toBe("2026-11-01");
    expect(morningReminder({ ...sunday, now: new Date("2026-11-01T09:00:00Z") })).toBeNull();
  });
  it("includes multiple saved plans without selecting or advancing one", () => {
    const routines = [...base.routines, { name: "Evening", sessionName: "Legs", plannedDays: ["MON"] }];
    expect(morningReminder({ ...base, routines })?.summary).toBe("Upper / Lower: Push day; Evening: Legs");
  });
  it("normalizes template parameters and preserves dollar signs when substituting", () => {
    expect(morningReminder({ ...base, routines: [{ name: "My\n plan", sessionName: "Cable\trow", plannedDays: ["MON"] }] })?.summary).toBe("My plan: Cable row");
    expect(renderMorningReminder("$& plan")).toContain("Today's plan: $& plan");
    const routines = Array.from({ length: 20 }, () => ({ name: "R".repeat(120), sessionName: "S".repeat(120), plannedDays: ["MON"] }));
    expect(morningReminder({ ...base, routines })?.summary).toBe("20 saved workout options are ready. Reply START to choose.");
  });
});
