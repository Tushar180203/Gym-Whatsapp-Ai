import { describe, expect, it } from "vitest";
import { formatWhatsAppMessage, whatsappReplyTitles } from "./response-layout.js";

describe("WhatsApp message presentation", () => {
  it("renders multiple sets and a clear continuation without changing recorded values", () => {
    const body = "Logged: 45 kg per hand/side x 10, 45 kg per hand/side x 9\nStay on Incline Press; send another set, NEXT or DONE.";
    expect(formatWhatsAppMessage(body, "SETS_LOGGED")).toBe("*✅ Sets recorded*\n\nSolid work. One set at a time! 💪\n\nLogged:\n• 45 kg per hand/side x 10\n• 45 kg per hand/side x 9\n\nStay on Incline Press; send another set, NEXT or DONE.");
  });
  it("keeps single-set acknowledgements concise", () => {
    expect(formatWhatsAppMessage("Logged: 0 kg total x 12", "SET_LOGGED")).toBe("*✅ Set recorded*\n\nSolid work. One set at a time! 💪\n\nLogged: 0 kg total x 12");
  });
  it("puts numbered workout alternatives on separate lines", () => {
    expect(formatWhatsAppMessage("Which routine/session? 1. Upper: Push; 2. Upper: Pull", "PENDING_QUESTION")).toBe("*🤔 Quick question*\n\nWhich routine/session?\n\n1. Upper: Push\n2. Upper: Pull");
  });
  it("shows finish and routine-scope choices as readable supported replies", () => {
    expect(formatWhatsAppMessage("Unfinished work remains. Save completed, save incomplete, continue, or discard?", "PENDING_QUESTION")).toBe("*🤔 Quick question*\n\nUnfinished work remains.\n\nReply with one option:\n• Save completed\n• Save incomplete\n• Continue\n• Discard");
    expect(formatWhatsAppMessage("No recorded sets. Save incomplete, continue, or discard?", "PENDING_QUESTION")).not.toContain("• Save completed");
    expect(formatWhatsAppMessage("Today only or update your routine?", "PENDING_QUESTION")).toBe("*🤔 Quick question*\n\nToday only or update your routine?\n\n• Today only\n• Update your routine\n\nReply TODAY or PERMANENT.");
  });
  it("separates a confirmation from its reply instructions", () => {
    expect(formatWhatsAppMessage("Replace Bench with Cable Fly today. Reply yes/confirm or no/cancel.", "CONFIRMATION_REQUIRED")).toBe("*🔎 Confirm your change*\n\nReplace Bench with Cable Fly today.\n\nReply yes/confirm or no/cancel.");
  });
  it("formats account connection and plan-ready notifications through the same boundary", () => {
    expect(formatWhatsAppMessage("WhatsApp connected successfully. You can now receive and log your workouts.")).toBe("*🎉 WhatsApp connected*\n\nWhatsApp connected successfully. You can now receive and log your workouts.");
    expect(formatWhatsAppMessage("Your workout plan Upper / Lower is ready. Send start when you want to train.")).toBe("*🗓️ Your plan is ready*\n\nYour workout plan Upper / Lower is ready.\n\nSend start when you want to train.");
  });
  it.each(Object.keys(whatsappReplyTitles) as (keyof typeof whatsappReplyTitles)[])("formats %s only once across conversation, storage and delivery boundaries", kind => {
    const result = formatWhatsAppMessage("A factual reply. Reply START to continue.", kind);
    expect(result.startsWith(`*${whatsappReplyTitles[kind]}*\n\n`)).toBe(true);
    expect(formatWhatsAppMessage(result)).toBe(result);
    expect(formatWhatsAppMessage(result, kind)).toBe(result);
  });
  it("preserves punctuation in names, numerical facts, dates and URLs", () => {
    const facts = "Plate-loaded row; neutral, wide\nHighest load: 42.5 LB each\n2026-10-29 (Asia/Kolkata)\nhttps://example.com/history?a=1&b=2";
    expect(formatWhatsAppMessage(facts, "HISTORY_FACT")).toBe(`*📖 Your training history*\n\n${facts}`);
  });
  it("preserves all facts instead of pushing a valid message over the provider limit", () => {
    const body = "A".repeat(4096);
    expect(formatWhatsAppMessage(body, "HISTORY_FACT")).toBe(body);
    const shorter = "A".repeat(4000);
    expect(formatWhatsAppMessage(shorter, "HISTORY_FACT").length).toBeLessThanOrEqual(4096);
    expect(formatWhatsAppMessage(shorter, "HISTORY_FACT")).toContain(shorter);
  });
  it("normalizes whitespace without introducing empty messages or repeated decoration", () => {
    expect(formatWhatsAppMessage("  \r\n ")).toBe("");
    expect(formatWhatsAppMessage(" hello\r\n\r\n\r\n Reply START.  ", "CONTEXTUAL_HELP")).toBe("*👋 Workout Companion*\n\nhello\n\nReply START.");
  });
  it("uses the requested hype at workout start, with calm factual recovery", () => {
    expect(formatWhatsAppMessage("Started Push", "WORKOUT_STARTED")).toBe("*🔥 Workout started*\n\nYeahh buddy, let's gooo! 💪🔥\n\nStarted Push");
    for (const kind of ["SYSTEM_ERROR", "PENDING_QUESTION", "CONFIRMATION_REQUIRED", "RECOVERY"] as const) expect(formatWhatsAppMessage("No set was recorded.", kind)).not.toMatch(/buddy|let.s go|Solid work|wrap|🙌/);
    expect(formatWhatsAppMessage("Push: discarded", "WORKOUT_FINISHED")).not.toContain("Nice work");
    expect(formatWhatsAppMessage("Push: incomplete", "WORKOUT_FINISHED")).not.toContain("Nice work");
  });
  it("retains already-persisted older replies without adding a second heading", () => {
    expect(formatWhatsAppMessage("*Set recorded*\n\nLogged: 45 kg total x 8")).toBe("*Set recorded*\n\nLogged: 45 kg total x 8");
  });
});
