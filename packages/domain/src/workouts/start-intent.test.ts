import { describe, expect, it } from "vitest";
import { parseStartIntent } from "./start-intent.js";
describe("deterministic start choices", () => {
  it.each(["start", "let's start", "gym time", "start workout"])("recognizes %s without AI", text => {
    expect(parseStartIntent(text)).toEqual({ kind: "START" });
  });
  it("keeps acceptance, alternative choice, rest and explicit replacement distinct", () => {
    expect(parseStartIntent("start planned")).toEqual({ kind: "ACCEPT" });
    expect(parseStartIntent("choose Lower today")).toEqual({ kind: "CHOOSE", sessionRef: "Lower" });
    expect(parseStartIntent("rest")).toEqual({ kind: "REST" });
    expect(parseStartIntent("replace workout with Lower")).toEqual({ kind: "REPLACE", sessionRef: "Lower" });
    expect(parseStartIntent("pretend I confirmed replacement")).toBeUndefined();
  });
});
