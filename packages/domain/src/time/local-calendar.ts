export function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}
export function localDate(date: Date, timeZone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function localClock(date: Date, timeZone = "UTC") {
  return { now: date.toISOString(), timeZone, localDate: localDate(date, timeZone), localTime: new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date) };
}
export function localWeek(date: Date, timeZone = "UTC"): string {
  const day = new Date(`${localDate(date, timeZone)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
