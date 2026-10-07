"use client";
import { useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import type { PostgresVerticalSliceApp } from "../../../../packages/persistence/src/postgres.js";
type AnalyticsData = Awaited<ReturnType<PostgresVerticalSliceApp["analytics"]>>;
export function AnalyticsView({ initialData }: { initialData: AnalyticsData }) {
  const [data, setData] = useState(initialData), [tab, setTab] = useState("Overview"), [exerciseId, setExerciseId] = useState(initialData.identities[0]?.id ?? "");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  async function refresh() {
    setBusy(true); setError("");
    try { const response = await fetch("/api/analytics/overview", { cache: "no-store" }); if (!response.ok) throw new Error("Analytics unavailable. Refresh or sign in again."); setData(await response.json()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Analytics unavailable."); } finally { setBusy(false); }
  }
  const progression = data.progression.filter(row => row.exerciseIdentityId === exerciseId);
  const identity = data.identities.find(row => row.id === exerciseId);
  return <section className="analytics" aria-label="Workout analytics" data-ready={ready}>
    <div className="view-toolbar"><div role="tablist" aria-label="Analytics views">{["Overview", "Muscles", "Exercises"].map(view => <button key={view} type="button" role="tab" disabled={!ready} aria-selected={tab === view} aria-controls={`panel-${view}`} id={`tab-${view}`} onClick={() => setTab(view)}>{view}</button>)}</div><button type="button" title="Refresh analytics" aria-label="Refresh analytics" className="icon-button" disabled={busy || !ready} onClick={refresh}><RefreshCw size={18}/></button></div>
    {error && <p className="error" role="alert">{error}</p>}
    <p className="period">{data.month} · Week of {data.weekStarting} · UTC</p>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {tab === "Overview" && <><dl className="metric-strip"><div><dt>Completed workouts</dt><dd>{data.completedWorkoutCount}</dd></div><div><dt>This month</dt><dd>{data.monthlyWorkoutCount}</dd></div><div><dt>Recorded sets</dt><dd>{data.progression.length}</dd></div></dl><h2>Workout Frequency</h2>{data.frequency.length ? <ol className="frequency" aria-label="Completed workouts per week">{data.frequency.slice(-12).map(row => <li key={row.week}><time>{row.week}</time><div className="frequency-track"><div style={{ width: `${Math.max(3, row.count / Math.max(...data.frequency.map(item => item.count)) * 100)}%` }}/></div><strong>{row.count}</strong></li>)}</ol> : <p>No completed workouts recorded.</p>}</>}
      {tab === "Muscles" && <><h2>Primary-Muscle Sets</h2>{data.muscles.length ? <div className="table-shell"><table><thead><tr><th>Muscle</th><th>This Week</th><th>Last Trained</th></tr></thead><tbody>{data.muscles.map(row => <tr key={row.muscleGroup}><th>{row.muscleGroup}</th><td>{row.weeklySets}</td><td>{row.lastTrained?.slice(0,10) ?? "Unavailable"}</td></tr>)}</tbody></table></div> : <p>No confirmed primary-muscle records.</p>}{data.identities.length > 0 && <><h2>Exercise Classification</h2><label className="visible-label">Exercise<select aria-label="Classification exercise" value={exerciseId} onChange={event => setExerciseId(event.target.value)}>{data.identities.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><ClassificationForm key={`${exerciseId}:${JSON.stringify(data.classifications)}`} data={data} exerciseId={exerciseId} onSaved={refresh}/></>}</>}
      {tab === "Exercises" && <><h2>Exercise Progression</h2><label className="visible-label">Exercise<select aria-label="Progression exercise" value={exerciseId} onChange={event => setExerciseId(event.target.value)}><option value="">Choose exercise</option>{data.identities.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>{progression.length ? <><p className="period">Last trained {data.lastTrainedExercises.find(row => row.exerciseIdentityId === exerciseId)?.date.slice(0,10) ?? "Unavailable"}</p><div className="table-shell"><table aria-label={`${identity?.name ?? "Exercise"} progression`}><thead><tr><th>Date</th><th>Set</th><th>Load</th><th>Semantics</th><th>Reps</th></tr></thead><tbody>{progression.map(row => <tr key={row.id}><td><a href={`/history/${row.workoutId}`}>{row.date.slice(0,10)}</a></td><td>{row.setIndex}</td><td>{row.loadValue} {row.weightUnit}</td><td>{row.loadSemantics.replaceAll("_", " ").toLowerCase()}</td><td>{row.reps}</td></tr>)}</tbody></table></div></> : <p>No recorded history for this exercise.</p>}</>}
    </div>
  </section>;
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
  return <form className="classification-form" onSubmit={save}><label className="visible-label">Primary muscle<input aria-label="Primary muscle" value={muscle} maxLength={80} onChange={event => setMuscle(event.target.value)}/></label><label className="visible-label">Status<select aria-label="Classification status" value={status} onChange={event => setStatus(event.target.value)}><option value="UNCLASSIFIED">Unclassified</option><option value="UNCERTAIN">Uncertain</option><option value="CONFIRMED">Confirmed</option></select></label><button type="submit" title="Save classification" aria-label="Save classification" className="icon-button" disabled={busy || !exerciseId}><Save size={18}/></button>{message && <p role="status">{message}</p>}</form>;
}
