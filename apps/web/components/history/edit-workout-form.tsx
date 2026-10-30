"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation.js";
import { Save, RotateCcw } from "lucide-react";
import type { EditableHistory } from "../../../../packages/persistence/src/postgres.js";
export function EditWorkoutForm({ initialHistory }: { initialHistory: EditableHistory }) {
  const router = useRouter();
  const [history, setHistory] = useState(initialHistory);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  async function save(set: EditableHistory["sets"][number]) {
    setSaving(set.id); setError(""); setMessage("");
    const idempotencyKey = keys[set.id] ?? crypto.randomUUID(); setKeys(current => ({ ...current, [set.id]: idempotencyKey }));
    try {
      const response = await fetch(`/api/workouts/${history.workout.id}/sets/${set.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replacement: { loadValue: set.loadValue, weightUnit: set.weightUnit, loadSemantics: set.loadSemantics, reps: set.reps }, idempotencyKey, expectedVersion: history.workout.version }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setHistory(current => ({ ...result.history, sets: result.history.sets.map((saved: EditableHistory["sets"][number]) => saved.id === set.id ? saved : current.sets.find(draft => draft.id === saved.id) ?? saved) })); setMessage("Set saved."); setKeys(current => { const copy = { ...current }; delete copy[set.id]; return copy; }); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save set."); } finally { setSaving(null); }
  }
  function update(id: string, values: Partial<EditableHistory["sets"][number]>) {
    setHistory(current => ({ ...current, sets: current.sets.map(set => set.id === id ? { ...set, ...values } : set) }));
    setKeys(current => { const copy = { ...current }; delete copy[id]; return copy; });
  }
  return <section aria-label="Recorded sets" data-ready={ready} aria-busy={saving !== null}><div className="set-header"><span>Exercise / Set</span><span>Load</span><span>Unit</span><span>Load Type</span><span>Reps</span><span/></div>{history.sets.map(set => <form className="set-row" key={set.id} onSubmit={event => { event.preventDefault(); void save(set); }}>
    <div className="exercise"><strong>{set.exerciseName}</strong><span>Set {set.setIndex}</span></div>
    <label><span>Load</span><input aria-label={`Set ${set.setIndex} load`} type="number" min="0" step="any" required value={set.loadValue} onChange={event => update(set.id, { loadValue: Number(event.target.value) })}/></label>
    <label><span>Unit</span><select aria-label={`Set ${set.setIndex} unit`} value={set.weightUnit} onChange={event => update(set.id, { weightUnit: event.target.value as "KG" | "LB" })}><option>KG</option><option>LB</option></select></label>
    <label><span>Load Type</span><select aria-label={`Set ${set.setIndex} load type`} value={set.loadSemantics} onChange={event => update(set.id, { loadSemantics: event.target.value as typeof set.loadSemantics })}><option value="UNSPECIFIED_DEFAULT">Default</option><option value="PER_HAND_PER_SIDE">Per hand / side</option><option value="TOTAL_LOAD">Total load</option><option value="MACHINE_STACK">Machine stack</option></select></label>
    <label><span>Reps</span><input aria-label={`Set ${set.setIndex} reps`} type="number" min="1" step="1" required value={set.reps} onChange={event => update(set.id, { reps: Number(event.target.value) })}/></label>
    <button className="icon-button" disabled={saving !== null} type="submit" aria-label={`Save set ${set.setIndex}`} title={`Save set ${set.setIndex}`}><Save size={18}/></button>
  </form>)}{message && <p role="status">{message}</p>}{error && <div className="error"><p role="alert">{error}</p><button type="button" className="icon-button" title="Refresh workout" aria-label="Refresh workout" onClick={() => location.reload()}><RotateCcw size={18}/></button></div>}</section>;
}
