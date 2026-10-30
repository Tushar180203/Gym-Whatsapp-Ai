"use client";
import "./analytics.css";
import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, Dumbbell, Flame, RefreshCw, Save, Sparkles, Target, TrendingUp } from "lucide-react";
import { localDate } from "../../../../packages/domain/src/time/local-calendar.js";
import { activityYear, exerciseSessions, muscleGroups, shiftDate, shortDate, trainingWeek, weeklyInsights, type AnalyticsData, type AiTrainingReview, type MuscleId } from "../../../../packages/analytics/src/training-insights.js";
import { MuscleMap } from "./muscle-map.js";
import { ActivityHeatmap } from "./activity-heatmap.js";
const tabs = ["Overview", "Muscles", "Exercises"] as const;
const number = (value: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
export function AnalyticsView({ initialData }: { initialData: AnalyticsData }) {
  const [data, setData] = useState(initialData), [tab, setTab] = useState<typeof tabs[number]>("Overview");
  const [exerciseId, setExerciseId] = useState(initialData.progression.at(-1)?.exerciseIdentityId ?? initialData.identities[0]?.id ?? "");
  const [week, setWeek] = useState(data.weekStarting), [selected, setSelected] = useState<MuscleId>("chest"), [secondary, setSecondary] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [review, setReview] = useState<AiTrainingReview | null>(null), [aiBusy, setAiBusy] = useState(false), [aiError, setAiError] = useState("");
  useEffect(() => setReady(true), []);
  const summary = useMemo(() => trainingWeek(data, week, review?.mappings), [data, week, review]);
  const activity = useMemo(() => activityYear(data), [data]);
  const facts = weeklyInsights(data, week, review?.mappings);
  const highlights = [...facts].sort((a, b) => (review?.highlightIds.includes(b.id) ? 1 : 0) - (review?.highlightIds.includes(a.id) ? 1 : 0));
  const current = summary.muscles.find(row => row.id === selected)!;
  const today = localDate(new Date(data.asOf), data.calendar);
  const delta = summary.sets.length - summary.previousSets.length;
  const weeks = Array.from({ length: 12 }, (_, index) => {
    const start = shiftDate(week, (index - 11) * 7);
    return { week: start, count: data.frequency.find(row => row.week === start)?.count ?? 0 };
  });
  async function refresh() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/analytics/overview", { cache: "no-store" });
      if (!response.ok) throw new Error("Analytics unavailable. Refresh or sign in again.");
      const next: AnalyticsData = await response.json(); setData(next); setReview(null); setAiError("");
      if (week === data.weekStarting) setWeek(next.weekStarting);
      if (!next.identities.some(row => row.id === exerciseId)) setExerciseId(next.identities[0]?.id ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Analytics unavailable."); } finally { setBusy(false); }
  }
  async function generateReview() {
    setAiBusy(true); setAiError("");
    try {
      const response = await fetch("/api/analytics/insights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ week }) });
      if (!response.ok) throw new Error("AI review could not load. Your workout insights are still available.");
      const result: AiTrainingReview = await response.json();
      if (!result.available) throw new Error("AI is unavailable right now. Your workout insights and standard muscle estimates are still available.");
      setReview(result);
    } catch (cause) { setAiError(cause instanceof Error ? cause.message : "AI review unavailable."); } finally { setAiBusy(false); }
  }
  function changeWeek(next: string) { setWeek(next); setReview(null); setAiError(""); }
  function navigateTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const index = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : -1) + 3) % 3;
    setTab(tabs[next]!); document.getElementById(`tab-${tabs[next]}`)?.focus();
  }
  function viewExercise(id: string) { setExerciseId(id); setTab("Exercises"); }
  const bodyPanel = <article className="insight-card muscle-card">
    <div className="insight-card-heading"><div><p className="eyebrow">YOUR TRAINING, MAPPED</p><h2>Where you put in the work</h2></div><span className="analytics-badge"><span className="red-dot"/> Weekly muscle map</span></div>
    <div className="muscle-layout"><div className="body-stage"><div className="body-stage-top"><span>{summary.trained}<small> / {muscleGroups.length} groups</small></span><label className="support-toggle"><input type="checkbox" checked={secondary} onChange={event => setSecondary(event.target.checked)}/> Supporting muscles</label></div>
      <MuscleMap muscles={summary.muscles} selected={selected} onSelect={setSelected} secondary={secondary}/>
      <div className="heat-legend"><span>No mapped sets</span><i/><i/><i/><i/><span>More primary sets</span></div><p className="map-hint">Select a muscle to explore its workouts.</p>
    </div><div className="muscle-detail" aria-live="polite"><p className="eyebrow">MUSCLE SPOTLIGHT</p><div className="muscle-detail-title"><h3>{current.name}</h3><Target size={20}/></div><div className="muscle-set-count">{current.sets}<span>primary sets this week</span></div>
      <div className="muscle-breakdown"><span><i className="confirmed-dot"/>{current.confirmed} confirmed</span><span><i className="estimated-dot"/>{current.estimated} estimated</span></div>
      <p className="support-note">+ {current.secondary} supporting sets · counted separately</p>
      <div className="muscle-exercise-list">{current.exercises.length ? current.exercises.map(exercise => <button key={exercise.id} type="button" onClick={() => viewExercise(exercise.id)}><span><strong>{exercise.name}</strong><small>{exercise.source === "ai" ? "AI estimate" : exercise.source === "estimated" ? "Standard estimate" : "Confirmed mapping"}</small></span><span>{exercise.sets || exercise.secondary}<small>{exercise.sets ? "sets" : "support"}</small><ChevronRight size={13}/></span></button>) : <p>No mapped sets for {current.name.toLowerCase()} this week. Choose another muscle or review your exercise mappings.</p>}</div>
      <p className="last-trained">Last logged by this week <strong>{current.lastTrained ? shortDate(localDate(new Date(current.lastTrained), data.calendar)) : "No history"}</strong></p>
    </div></div>
    <div className="muscle-chips" aria-label="Select muscle group">{summary.muscles.map(muscle => <button key={muscle.id} type="button" aria-pressed={selected === muscle.id} className={muscle.sets ? "is-trained" : ""} onClick={() => setSelected(muscle.id)}>{muscle.name}<span>{muscle.sets}</span></button>)}</div>
    <p className="analytics-footnote">Color shows relative primary set counts, including labeled estimates. Supporting muscles use a pale tint when enabled. This is a training log, not a measure of growth, fatigue, or recovery.</p>
    {summary.unmapped.length > 0 && <div className="mapping-notice"><Sparkles size={16}/><span>{summary.unmapped.length} sets still need a primary muscle mapping.</span><button type="button" onClick={() => setTab("Muscles")}>Review mappings <ArrowUpRight size={13}/></button></div>}
  </article>;
  return <section className="analytics analytics-dashboard" aria-label="Workout analytics" data-ready={ready} aria-busy={busy}>
    <div className="page-intro"><div><p className="eyebrow">THE BIGGER PICTURE</p><h1>Progress & insights<span className="heading-dot">.</span></h1><p>Every rep tells a story. Here’s yours.</p></div><a className="command-button" href="/history">View workout history <ArrowUpRight size={16}/></a></div>
    <div className="analytics-toolbar"><div role="tablist" aria-label="Analytics views" onKeyDown={navigateTab}>{tabs.map(view => <button key={view} type="button" role="tab" tabIndex={tab === view ? 0 : -1} disabled={!ready} aria-selected={tab === view} aria-controls={tab === view ? `panel-${view}` : undefined} id={`tab-${view}`} onClick={() => setTab(view)}>{view}</button>)}</div>
      <div className="analytics-period-controls"><button type="button" className="icon-button" aria-label="Previous week" disabled={!ready || aiBusy} onClick={() => changeWeek(shiftDate(week, -7))}><ChevronLeft size={17}/></button><span><CalendarDays size={14}/>{shortDate(week)} – {shortDate(shiftDate(week, 6))}<small>{week.slice(0, 4)}</small></span><button type="button" className="icon-button" aria-label="Next week" disabled={week >= data.weekStarting || aiBusy || !ready} onClick={() => changeWeek(shiftDate(week, 7))}><ChevronRight size={17}/></button><button type="button" className="icon-button" aria-label="Refresh analytics" disabled={busy || aiBusy || !ready} onClick={refresh}><RefreshCw size={16} className={busy ? "is-spinning" : ""}/></button></div>
    </div>
    <div className="analytics-period-note"><span>{week === data.weekStarting ? "This week · in progress" : "Weekly review"} · {data.calendar}</span>{week !== data.weekStarting && <button type="button" disabled={aiBusy} onClick={() => changeWeek(data.weekStarting)}>Back to this week</button>}<span>Updated {shortDate(today)}</span></div>
    {error && <p className="error" role="alert">{error}</p>}
    {!data.workouts.length && <div className="analytics-empty"><span className="metric-icon"><Dumbbell size={22}/></span><div><strong>Your progress starts with your first workout.</strong><p>Log your sets in WhatsApp and finish your workout to bring this page to life.</p></div><a className="command-button primary-button" href="/routines">Go to routines <ArrowUpRight size={14}/></a></div>}
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {tab === "Overview" && <>
        <div className="weekly-metrics">
          <Metric icon={<Dumbbell size={18}/>} label="Workouts completed" value={summary.completed} detail={`${summary.activeDays} active days this week`}/>
          <Metric icon={<Activity size={18}/>} label="Recorded sets" value={summary.sets.length} detail={summary.previousSets.length ? `${delta > 0 ? "+" : ""}${delta} vs last week` : "Your weekly training volume"} trend={summary.previousSets.length ? delta : undefined}/>
          <Metric icon={<Target size={18}/>} label="Muscle groups hit" value={`${summary.trained}/${muscleGroups.length}`} detail="Primary sets · includes estimates"/>
          <Metric icon={<Flame size={18}/>} label="Reps put in" value={number(summary.reps)} detail="Every recorded rep counts"/>
        </div>
        <ActivityHeatmap activity={activity} onSelectWeek={changeWeek}/>
        <div className="analytics-main-grid">{bodyPanel}<aside className="analytics-right-column">
          <article className="insight-card week-activity"><div className="insight-card-heading"><div><p className="eyebrow">SHOWING UP</p><h2>Your week at a glance</h2></div><CalendarDays size={18}/></div><div className="activity-days">{summary.days.map((day, index) => <div key={day.date} className={day.date > today ? "future-day" : ""}><span>{["M", "T", "W", "T", "F", "S", "S"][index]}</span><div className={`activity-day ${day.workouts.some(row => row.status === "COMPLETED") ? "completed-day" : day.sets ? "partial-day" : ""}`} title={`${day.date}: ${day.workouts.length} saved workouts, ${day.sets} sets`} aria-label={`${day.date}: ${day.workouts.length} saved workouts, ${day.sets} sets`}>{day.workouts.some(row => row.status === "COMPLETED") ? <Check size={15}/> : day.sets ? <span className="status-dot"/> : <span>·</span>}</div><small>{day.date.slice(-2)}</small></div>)}</div><p>{summary.activeDays ? <><strong>{summary.activeDays} days of showing up.</strong> Keep building your story.</> : "A fresh week, a fresh opportunity to move."}</p><div className="activity-legend"><span><i/>Completed</span><span><i/>Incomplete with sets</span></div></article>
          <article className="insight-card coach-card"><div className="coach-icon"><Sparkles size={19}/></div><p className="eyebrow">MAKE YOUR DATA USEFUL</p><h2>A little clarity.<br/>A stronger next step.</h2><p>Get AI muscle estimates for your logged exercises and a focused review of your week.</p><button type="button" className="command-button lime-button" disabled={!ready || aiBusy || busy || !data.progression.length} onClick={generateReview}>{aiBusy ? <RefreshCw size={15} className="is-spinning"/> : <Sparkles size={15}/>} {aiBusy ? "Reviewing your workouts…" : review ? "Refresh AI review" : "Generate AI review"}</button><small>Uses exercise names and weekly summaries. Estimates are yours to review.</small>{review && <p className="ai-success" role="status"><Check size={14}/>{review.mappings.length} AI exercise mappings ready to review.</p>}{aiError && <p className="ai-error" role="status">{aiError}</p>}</article>
        </aside></div>
        <div className="insights-heading"><div><p className="eyebrow">CONNECT THE DOTS</p><h2>Your weekly takeaways</h2></div><span className="analytics-badge">{review ? "AI-prioritized · verified numbers" : "From your recorded workouts"}</span></div><div className="takeaway-grid">{highlights.slice(0, 3).map((fact, index) => <article className="takeaway" key={fact.id}><span className="takeaway-number">0{index + 1}</span><h3>{fact.title}</h3><p>{fact.text}</p></article>)}</div>
        <article className="insight-card frequency-card"><div className="insight-card-heading"><div><p className="eyebrow">CONSISTENCY OVER TIME</p><h2>Workout Frequency</h2></div><span className="analytics-badge">12 weeks · completed workouts</span></div><div className="frequency-chart" aria-label="Completed workouts per week">{weeks.map((row, index) => <button type="button" key={row.week} disabled={aiBusy} onClick={() => changeWeek(row.week)} aria-label={`Week of ${row.week}: ${row.count} completed workouts`} aria-pressed={row.week === week}><span className="frequency-count">{row.count}</span><span className="frequency-column"><i style={{ height: row.count ? `${Math.max(5, row.count / Math.max(1, ...weeks.map(item => item.count)) * 100)}%` : "3px" }}/></span><span className="frequency-date">{index % 2 === 0 || index === 11 ? shortDate(row.week) : ""}</span></button>)}</div>{!data.completedWorkoutCount && <p className="analytics-footnote">No completed workouts recorded.</p>}<p className="analytics-footnote">Select a bar to explore that week. Weeks with no completed workouts stay visible.</p></article>
        <dl className="metric-strip lifetime-metrics"><div><dt>Completed workouts · all time</dt><dd>{data.completedWorkoutCount}</dd></div><div><dt>This month · {data.month}</dt><dd>{data.monthlyWorkoutCount}</dd></div><div><dt>Recorded sets · all time</dt><dd>{data.progression.length}</dd></div></dl>
      </>}
      {tab === "Muscles" && <>{bodyPanel}<article className="insight-card muscle-table-card"><div className="insight-card-heading"><div><p className="eyebrow">THE DETAILS BEHIND THE MAP</p><h2>Primary-Muscle Sets</h2></div></div>{!data.muscles.some(row => row.lastTrained) && <p className="analytics-footnote">No confirmed primary-muscle records.</p>}<div className="table-shell"><table><thead><tr><th>Muscle</th><th>This Week</th><th>Confirmed / Estimated</th><th>Supporting</th><th>Last Trained</th></tr></thead><tbody>{summary.muscles.map(row => <tr key={row.id}><th><button className="table-muscle-button" onClick={() => setSelected(row.id)}>{row.name}</button></th><td>{row.sets}</td><td>{row.confirmed} / {row.estimated}</td><td>{row.secondary}</td><td>{row.lastTrained ? localDate(new Date(row.lastTrained), data.calendar) : "No history"}</td></tr>)}</tbody></table></div><p className="analytics-footnote">A set can involve several muscles. Muscle counts are not added together as total workout sets. Broad “back” and “core” classifications appear as upper back and abs.</p></article>
        {data.identities.length > 0 && <article className="insight-card classification-card"><p className="eyebrow">YOU KNOW YOUR WORKOUT BEST</p><h2>Exercise Classification</h2><p>Confirm or correct a primary muscle. Only confirmed classifications count as verified; uncertain classifications stay out of the map.</p><label className="visible-label">Exercise<select aria-label="Classification exercise" value={exerciseId} onChange={event => setExerciseId(event.target.value)}>{data.identities.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><ClassificationForm key={`${exerciseId}:${JSON.stringify(data.classifications)}`} data={data} exerciseId={exerciseId} onSaved={refresh}/>{review?.mappings.find(row => row.exerciseIdentityId === exerciseId) && <p className="mapping-suggestion"><Sparkles size={15}/>AI suggests: {review.mappings.find(row => row.exerciseIdentityId === exerciseId)!.primary.map(id => muscleGroups.find(row => row.id === id)!.name).join(", ")}. Choose a muscle above and save as confirmed if it matches your exercise.</p>}</article>}</>}
      {tab === "Exercises" && <ExerciseProgress data={data} exerciseId={exerciseId} onSelect={setExerciseId}/>}
    </div>
    <p className="analytics-bottom-note">Saved completed and incomplete workouts contribute recorded sets. Deleted sets and discarded workouts are excluded. Weeks start Monday in your saved time zone.</p>
  </section>;
}
function Metric({ icon, label, value, detail, trend }: { icon: React.ReactNode; label: string; value: string | number; detail: string; trend?: number | undefined }) {
  return <article className="weekly-metric"><div><span>{label}</span><span className="weekly-metric-icon">{icon}</span></div><strong>{value}</strong><p>{trend !== undefined && (trend >= 0 ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>)}{detail}</p></article>;
}
function ExerciseProgress({ data, exerciseId, onSelect }: { data: AnalyticsData; exerciseId: string; onSelect: (id: string) => void }) {
  const all = data.progression.filter(row => row.exerciseIdentityId === exerciseId);
  const variants = [...new Set(all.map(row => `${row.weightUnit}:${row.loadSemantics}`))];
  const [chosenVariant, setChosenVariant] = useState("");
  const variant = variants.includes(chosenVariant) ? chosenVariant : variants[0] ?? "";
  const [unit, semantics] = variant.split(":");
  const [chartMetric, setChartMetric] = useState<"bestLoad" | "reps" | "volume">("bestLoad");
  const sessions = exerciseSessions(data, exerciseId, unit ?? "", semantics ?? "");
  const visible = sessions.slice(-16), latest = sessions.at(-1), previous = sessions.at(-2);
  const max = Math.max(1, ...visible.map(row => row[chartMetric]));
  const points = visible.map((row, index) => `${visible.length === 1 ? 300 : 32 + index / (visible.length - 1) * 536},${160 - row[chartMetric] / max * 130}`);
  const label = chartMetric === "bestLoad" ? `Top recorded load (${unit})` : chartMetric === "reps" ? "Total reps" : `Recorded load × reps (${unit})`;
  const identity = data.identities.find(row => row.id === exerciseId);
  const progression = all.filter(row => row.weightUnit === unit && row.loadSemantics === semantics);
  return <div className="exercise-progress"><article className="insight-card"><div className="insight-card-heading"><div><p className="eyebrow">YOUR STRENGTH STORY</p><h2>Exercise Progression</h2></div><TrendingUp size={21}/></div><div className="exercise-filters"><label className="visible-label">Exercise<select aria-label="Progression exercise" value={exerciseId} onChange={event => onSelect(event.target.value)}><option value="">Choose exercise</option>{data.identities.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>{variants.length > 0 && <label className="visible-label">Compare like for like<select aria-label="Load type" value={variant} onChange={event => setChosenVariant(event.target.value)}>{variants.map(value => <option key={value} value={value}>{value.replace(":", " · ").replaceAll("_", " ").toLowerCase()}</option>)}</select></label>}</div>
    {latest ? <><div className="exercise-stats"><div><span>Highest recorded load</span><strong>{number(Math.max(...sessions.map(row => row.bestLoad)))} <small>{unit}</small></strong></div><div><span>Latest session · {shortDate(localDate(new Date(latest.date), data.calendar))}</span><strong>{latest.sets} <small>sets · {latest.reps} reps</small></strong></div><div><span>Top load vs previous session</span><strong>{previous ? `${latest.bestLoad - previous.bestLoad > 0 ? "+" : ""}${number(latest.bestLoad - previous.bestLoad)}` : "—"} <small>{previous ? unit : "Needs two sessions"}</small></strong></div></div>
      <div className="chart-toolbar"><h3>{label}</h3><div className="chart-metric-switch" aria-label="Chart metric">{([ ["bestLoad", "Load"], ["reps", "Reps"], ["volume", "Volume"] ] as const).map(([id, name]) => <button type="button" key={id} aria-pressed={chartMetric === id} onClick={() => setChartMetric(id)}>{name}</button>)}</div></div>
      <svg className="progress-chart" viewBox="0 0 600 195" role="img" aria-label={`${identity?.name}: ${label}, last ${visible.length} sessions. ${visible.map(row => `${localDate(new Date(row.date), data.calendar)}: ${number(row[chartMetric])}`).join("; ")}`}>
        {[30, 95, 160].map((y, index) => <g key={y}><line x1="32" x2="568" y1={y} y2={y} stroke="#e6eadd" strokeDasharray="4 5"/><text x="29" y={y - 7} fill="#7e8874" fontSize="10">{number(max * (1 - index / 2))}</text></g>)}
        {points.length > 1 && <><path d={`M${points.join(" L")} L568,160 L32,160 Z`} fill="#d8f36a" opacity=".2"/><polyline points={points.join(" ")} fill="none" stroke="#718e3e" strokeWidth="3" strokeLinejoin="round"/></>}
        {points.map((point, index) => <circle key={visible[index]!.workoutId} cx={point.split(",")[0]} cy={point.split(",")[1]} r="5" fill="#486132" stroke="white" strokeWidth="2"><title>{shortDate(localDate(new Date(visible[index]!.date), data.calendar))}: {number(visible[index]![chartMetric])}</title></circle>)}
        <text x="32" y="187" fontSize="11" fill="#7e8874">{shortDate(localDate(new Date(visible[0]!.date), data.calendar))}</text>{visible.length > 1 && <text x="568" y="187" textAnchor="end" fontSize="11" fill="#7e8874">{shortDate(localDate(new Date(latest.date), data.calendar))}</text>}
      </svg><p className="analytics-footnote">{sessions.length} comparable sessions · last {visible.length} shown. Units and load types are kept separate. Volume uses the recorded load × reps, without doubling per-hand loads or estimating body weight. A higher assistance load does not mean greater strength.</p>
    </> : <div className="chart-empty"><TrendingUp size={32}/><h3>Your progress will appear here</h3><p>No recorded history for this exercise.</p></div>}</article>
    {progression.length > 0 && <article className="insight-card"><div className="insight-card-heading"><h2>The reps behind the results</h2><span className="analytics-badge">{progression.length} recorded sets</span></div><div className="table-shell"><table aria-label={`${identity?.name ?? "Exercise"} progression`}><thead><tr><th>Date</th><th>Set</th><th>Load</th><th>Semantics</th><th>Reps</th></tr></thead><tbody>{[...progression].reverse().map(row => <tr key={row.id}><td><a href={`/history/${row.workoutId}`}>{localDate(new Date(row.date), data.calendar)}</a></td><td>{row.setIndex}</td><td>{row.loadValue} {row.weightUnit}</td><td>{row.loadSemantics.replaceAll("_", " ").toLowerCase()}</td><td>{row.reps}</td></tr>)}</tbody></table></div></article>}
  </div>;
}
function ClassificationForm({ data, exerciseId, onSaved }: { data: AnalyticsData; exerciseId: string; onSaved: () => Promise<void> }) {
  const existing = data.classifications.filter(row => row.exerciseIdentityId === exerciseId), primary = existing.find(row => row.role === "PRIMARY");
  const [muscle, setMuscle] = useState(primary?.muscleGroup ?? ""), [status, setStatus] = useState(primary?.status ?? "UNCLASSIFIED"), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const classifications = [...existing.filter(row => row !== primary).map(row => ({ muscleGroup: row.muscleGroup, role: row.role, status: row.status })), ...(muscle.trim() ? [{ muscleGroup: muscle.trim(), role: "PRIMARY", status }] : [])];
    try { const response = await fetch(`/api/exercises/${exerciseId}/classification`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ classifications }) }); if (!response.ok) throw new Error("Classification could not be saved."); await onSaved(); setMessage("Classification saved."); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Classification could not be saved."); } finally { setBusy(false); }
  }
  return <form className="classification-form" onSubmit={save}><datalist id="analytics-muscle-names">{muscleGroups.map(row => <option key={row.id} value={row.name}/>)}</datalist><label className="visible-label">Primary muscle<input list="analytics-muscle-names" aria-label="Primary muscle" value={muscle} maxLength={80} onChange={event => setMuscle(event.target.value)}/></label><label className="visible-label">Status<select aria-label="Classification status" value={status} onChange={event => setStatus(event.target.value)}><option value="UNCLASSIFIED">Unclassified</option><option value="UNCERTAIN">Uncertain</option><option value="CONFIRMED">Confirmed</option></select></label><button type="submit" title="Save classification" aria-label="Save classification" className="icon-button" disabled={busy || !exerciseId}><Save size={18}/></button>{message && <p role="status">{message}</p>}</form>;
}
