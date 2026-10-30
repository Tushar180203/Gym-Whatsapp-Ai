import { localClock, localDate, validTimeZone } from "../time/local-calendar.js";
export type ReminderRoutine = { name: string; sessionName: string; plannedDays: string[] };
export type MorningReminderInput = { enabled: boolean; timeZone: string; now: Date; routines: ReminderRoutine[]; hasActiveWorkout: boolean; trainedToday: boolean };
export const reminderTemplateCopy = "⏰ *5 AM workout reminder*\n\nToday's plan: {{1}}\n\nYeahh buddy, let's gooo! 💪🔥\n\nReply START to see your workout. Turn reminders off in your profile.";
export function renderMorningReminder(summary: string): string { return reminderTemplateCopy.replace("{{1}}", () => summary); }
export function morningReminder(input: MorningReminderInput) {
  if (!input.enabled || input.hasActiveWorkout || input.trainedToday || !validTimeZone(input.timeZone)) return null;
  const clock = localClock(input.now, input.timeZone), minute = Number(clock.localTime.slice(3, 5));
  if (clock.localTime.slice(0, 2) !== "05" || minute >= 10) return null;
  const weekday = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(`${clock.localDate}T00:00:00Z`).getUTCDay()]!;
  const plans = input.routines.filter(row => row.plannedDays.includes(weekday));
  if (!plans.length) return null;
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const list = plans.map(row => `${clean(row.name)}: ${clean(row.sessionName)}`).join("; ");
  const summary = list.length <= 900 ? list : `${plans.length} saved workout options are ready. Reply START to choose.`;
  const expiresAt = new Date(input.now.getTime() + (15 - minute) * 60_000 - input.now.getUTCSeconds() * 1000 - input.now.getUTCMilliseconds());
  return { localDate: localDate(input.now, input.timeZone), summary, body: renderMorningReminder(summary), expiresAt };
}
