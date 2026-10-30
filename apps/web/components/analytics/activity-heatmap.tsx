import { Fragment, useEffect, useRef } from "react";
import { CalendarDays, Flame, Trophy, Zap } from "lucide-react";
import { shortDate, type activityYear } from "../../../../packages/analytics/src/training-insights.js";
type Activity = ReturnType<typeof activityYear>;
const monthName = (date: string) => new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const plural = (value: number, word: string) => `${value} ${word}${value === 1 ? "" : "s"}`;
export function ActivityHeatmap({ activity, onSelectWeek }: { activity: Activity; onSelectWeek: (week: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth; }, []);
  const { columns, currentStreak, longestStreak, weekStreak, activeToday, activeDays, workouts } = activity;
  const months = columns.map((week, index) => { const first = week.find(day => day.date.endsWith("-01")); if (first) return monthName(first.date); return index === 0 && !columns.slice(1, 3).some(next => next.some(day => day.date.endsWith("-01"))) ? monthName(week[0]!.date) : ""; });
  const nudge = activeToday ? "Today is logged. Streak extended." : currentStreak ? `Log today's workout to make it ${plural(currentStreak + 1, "day")}.` : "Log a workout today to start a new streak.";
  return <article className="insight-card activity-year-card">
    <div className="insight-card-heading"><div><p className="eyebrow">SHOWING UP, ALL YEAR</p><h2>{plural(workouts, "workout")} in the past year</h2></div><span className="analytics-badge"><CalendarDays size={13}/> {plural(activeDays, "active day")}</span></div>
    <div className="streak-stats">
      <div className={`streak-stat streak-current${activeToday ? " is-lit" : ""}`}><span className="streak-icon"><Flame size={19}/></span><div><strong>{currentStreak}<small> {currentStreak === 1 ? "day" : "days"}</small></strong><span>Current streak</span></div></div>
      <div className="streak-stat"><span className="streak-icon"><Trophy size={17}/></span><div><strong>{longestStreak}<small> {longestStreak === 1 ? "day" : "days"}</small></strong><span>Longest streak</span></div></div>
      <div className="streak-stat"><span className="streak-icon"><Zap size={17}/></span><div><strong>{weekStreak}<small> {weekStreak === 1 ? "week" : "weeks"}</small></strong><span>Weeks in a row</span></div></div>
      <p className="streak-nudge" role="status">{nudge}</p>
    </div>
    <div className="year-heatmap-scroll" ref={scroller}>
      <div className="year-heatmap" style={{ gridTemplateColumns: `28px repeat(${columns.length}, minmax(var(--cell), 1fr))` }}>
        {months.map((month, index) => month && <span key={columns[index]![0]!.date} className="heatmap-month" style={index > columns.length - 3 ? { gridRow: 1, gridColumn: `${columns.length - 1} / span 3`, textAlign: "right" } : { gridRow: 1, gridColumn: `${index + 2} / span 3` }}>{month}</span>)}
        {["Mon", "", "Wed", "", "Fri", "", ""].map((weekdayLabel, weekday) => <Fragment key={weekday}>
          <span className="heatmap-weekday" style={{ gridRow: weekday + 2, gridColumn: 1 }}>{weekdayLabel}</span>
          {columns.map((week, index) => { const day = week[weekday]!, place = { gridRow: weekday + 2, gridColumn: index + 2 }; const label = `${shortDate(day.date)}, ${day.date.slice(0, 4)}: ${day.workouts ? `${plural(day.workouts, "workout")}, ${plural(day.sets, "set")}` : "no workouts"}`;
            return day.future ? <span key={day.date} className="heatmap-cell is-future" style={place}/> : <button type="button" tabIndex={-1} key={day.date} style={place} className={`heatmap-cell level-${day.level}${day.date === activity.today ? " is-today" : ""}`} title={label} aria-label={label} onClick={() => onSelectWeek(week[0]!.date)}/>; })}
        </Fragment>)}
      </div>
    </div>
    <div className="heatmap-footer"><p className="analytics-footnote">Select a day to review that week. Color shows recorded sets that day.</p><div className="heatmap-legend" aria-hidden="true"><span>Less</span>{[0, 1, 2, 3, 4].map(level => <i key={level} className={`heatmap-cell level-${level}`}/>)}<span>More</span></div></div>
  </article>;
}
