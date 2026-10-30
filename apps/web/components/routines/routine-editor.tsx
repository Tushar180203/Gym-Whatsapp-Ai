"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { ExercisePicker } from "./exercise-picker.js";
import type { ConfiguredExercise, ConfiguredRoutine } from "../../../../packages/persistence/src/configuration.js";

export async function setupRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request could not be applied.");
  if (data.clarification) throw new Error(data.clarification);
  return data as T;
}
type SessionDraft = { id?: string; name: string; exercises: Array<{ exerciseIdentityId: string; plannedSetCount: number; repTargetMin: number; repTargetMax: number }> };
const days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export function RoutineEditor({ initial, onSaved }: { initial?: ConfiguredRoutine; onSaved: (routine: ConfiguredRoutine) => void }) {
  const [name, setName] = useState(initial?.name ?? ""), [sessions, setSessions] = useState<SessionDraft[]>(initial?.sessions ?? [{ name: "", exercises: [] }]);
  const [exercises, setExercises] = useState<ConfiguredExercise[]>([]), [frequency, setFrequency] = useState(initial?.schedule.intendedWorkoutsPerWeek ?? 3);
  const [plannedDays, setPlannedDays] = useState(initial?.schedule.plannedDays ?? []), [busy, setBusy] = useState(false), [status, setStatus] = useState("");
  const [customName, setCustomName] = useState(""), [semantics, setSemantics] = useState("UNSPECIFIED_DEFAULT"), [confirmed, setConfirmed] = useState(false);
  const [sequenceConfirmed, setSequenceConfirmed] = useState(false);
  useEffect(() => { setupRequest<ConfiguredExercise[]>("/api/exercises").then(setExercises).catch(error => setStatus(error.message)); }, []);
  const changeSession = (index: number, value: SessionDraft) => setSessions(previous => previous.map((session, i) => i === index ? value : session));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (sessions.some(session => session.exercises.some(exercise => !exercise.exerciseIdentityId))) { setStatus("Choose an exercise from the suggestions for each row."); return; }
    setBusy(true); setStatus("");
    try {
      const routine = await setupRequest<ConfiguredRoutine>(initial ? `/api/routines/${initial.id}` : "/api/routines", initial ? "PATCH" : "POST", {
        name, sessions: sessions.map(session => ({ ...(session.id ? { id: session.id } : {}), name: session.name, exercises: session.exercises })),
        schedule: { intendedWorkoutsPerWeek: frequency, plannedDays }, ...(initial ? { expectedVersion: initial.version, ...(sequenceConfirmed ? { confirmSequenceChange: true } : {}) } : {})
      });
      setStatus("Routine saved."); onSaved(routine);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Save failed."); } finally { setBusy(false); }
  }
  async function createCustom() {
    setBusy(true);
    try {
      const exercise = await setupRequest<ConfiguredExercise>("/api/exercises/custom", "POST", { name: customName, defaultLoadSemantics: semantics, confirm: confirmed });
      setExercises(previous => [...previous, exercise]); setCustomName(""); setConfirmed(false); setStatus("Custom exercise confirmed.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Exercise unavailable."); } finally { setBusy(false); }
  }
  return <><form onSubmit={save} className="setup-form">
    <label className="visible-label">Routine name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
    <div className="setup-grid"><label className="visible-label">Intended workouts per week<input type="number" min={1} max={14} required value={frequency} onChange={event => setFrequency(Number(event.target.value))} /></label>
    <fieldset><legend>Planned days</legend><div className="day-options">{days.map(day => <label key={day}><input type="checkbox" checked={plannedDays.includes(day)} onChange={event => setPlannedDays(previous => event.target.checked ? [...previous, day] : previous.filter(item => item !== day))} />{day}</label>)}</div></fieldset></div>
    {sessions.map((session, index) => <fieldset key={index} className="session-editor"><legend>Session {index + 1}</legend>
      <div className="setup-grid"><label className="visible-label">Session name<input required value={session.name} onChange={event => changeSession(index, { ...session, name: event.target.value })} /></label>
      <div className="data-actions"><button type="button" className="icon-button" title="Move session up" aria-label={`Move session ${index + 1} up`} disabled={index === 0} onClick={() => { const next = [...sessions]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; setSessions(next); }}><ArrowUp size={18} /></button>
      <button type="button" className="icon-button" title="Remove session" aria-label={`Remove session ${index + 1}`} disabled={sessions.length === 1} onClick={() => setSessions(previous => previous.filter((_, i) => i !== index))}><Trash2 size={18} /></button></div></div>
      {session.exercises.map((exercise, order) => <div className="planned-exercise" key={order}>
        <ExercisePicker exercises={exercises} onSuggestNew={suggestion => { setCustomName(suggestion); setConfirmed(false); setStatus("Review and confirm the suggested exercise below, then select it in your session."); document.getElementById("custom-exercise")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} value={exercise.exerciseIdentityId} onChange={id => changeSession(index, { ...session, exercises: session.exercises.map((item, i) => i === order ? { ...item, exerciseIdentityId: id } : item) })} />
        {([['Sets', 'plannedSetCount'], ['Min reps', 'repTargetMin'], ['Max reps', 'repTargetMax']] as const).map(([label, field]) => <label className="visible-label" key={field}>{label}<input type="number" min={1} max={field === 'plannedSetCount' ? 100 : 1000} required value={exercise[field]} onChange={event => changeSession(index, { ...session, exercises: session.exercises.map((item, i) => i === order ? { ...item, [field]: Number(event.target.value) } : item) })} /></label>)}
        <div className="data-actions"><button type="button" className="icon-button" title="Move exercise up" aria-label={`Move exercise ${order + 1} up in session ${index + 1}`} disabled={order === 0} onClick={() => { const next = [...session.exercises]; [next[order - 1], next[order]] = [next[order]!, next[order - 1]!]; changeSession(index, { ...session, exercises: next }); }}><ArrowUp size={18} /></button>
        <button type="button" className="icon-button" title="Move exercise down" aria-label={`Move exercise ${order + 1} down in session ${index + 1}`} disabled={order === session.exercises.length - 1} onClick={() => { const next = [...session.exercises]; [next[order + 1], next[order]] = [next[order]!, next[order + 1]!]; changeSession(index, { ...session, exercises: next }); }}><ArrowDown size={18} /></button>
        <button type="button" className="icon-button" title="Remove planned exercise" aria-label={`Remove exercise ${order + 1} from session ${index + 1}`} onClick={() => changeSession(index, { ...session, exercises: session.exercises.filter((_, i) => i !== order) })}><Trash2 size={18} /></button></div>
      </div>)}
      <button type="button" className="command-button" onClick={() => changeSession(index, { ...session, exercises: [...session.exercises, { exerciseIdentityId: "", plannedSetCount: 3, repTargetMin: 8, repTargetMax: 10 }] })}><Plus size={18} />Add exercise</button>
    </fieldset>)}
    {initial && <label className="confirmation-check"><input type="checkbox" checked={sequenceConfirmed} onChange={event => setSequenceConfirmed(event.target.checked)} />Confirm permanent session sequence changes</label>}
    <div className="data-actions"><button type="button" className="command-button" onClick={() => setSessions(previous => [...previous, { name: "", exercises: [] }])}><Plus size={18} />Add session</button><button className="command-button" disabled={busy}><Save size={18} />Save routine</button></div>
  </form><section id="custom-exercise" className="data-band"><h2>Custom exercise</h2><div className="setup-grid"><label className="visible-label">Custom exercise name<input value={customName} onChange={event => setCustomName(event.target.value)} /></label>
    <label className="visible-label">Load semantics<select value={semantics} onChange={event => setSemantics(event.target.value)}><option value="UNSPECIFIED_DEFAULT">Unspecified/default</option><option value="PER_HAND_PER_SIDE">Per hand / side</option><option value="TOTAL_LOAD">Total load</option><option value="MACHINE_STACK">Machine stack</option></select></label></div>
    <label className="confirmation-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Confirm new exercise identity and load semantics</label>
    <button type="button" className="command-button" disabled={busy || !confirmed || !customName.trim()} onClick={createCustom}><Plus size={18} />Create custom exercise</button></section><p role="status" aria-live="polite">{status}</p></>;
}
