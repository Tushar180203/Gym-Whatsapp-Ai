"use client";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import type { ConfiguredExercise } from "../../../../packages/persistence/src/configuration.js";
import { setupRequest } from "./routine-editor.js";
export function ExerciseIdentityControls() {
  const [exercises, setExercises] = useState<ConfiguredExercise[]>([]), [id, setId] = useState(""), [name, setName] = useState(""), [alias, setAlias] = useState(""), [confirmed, setConfirmed] = useState(false), [status, setStatus] = useState("");
  const load = () => setupRequest<ConfiguredExercise[]>("/api/exercises").then(setExercises);
  useEffect(() => { load().catch(error => setStatus(error.message)); }, []);
  const selected = exercises.find(exercise => exercise.id === id);
  async function save(kind: "rename" | "alias") {
    if (!selected) return;
    try { await setupRequest(`/api/exercises/${id}${kind === "alias" ? "/aliases" : ""}`, kind === "alias" ? "POST" : "PATCH", kind === "alias" ? { alias, confirm: confirmed } : { displayName: name, expectedVersion: selected.version }); await load(); setStatus("Exercise saved."); setAlias(""); setConfirmed(false); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Request failed."); }
  }
  return <section className="data-band"><h2>Exercise identities</h2><label className="visible-label">Managed exercise<select value={id} onChange={event => { setId(event.target.value); setName(exercises.find(exercise => exercise.id === event.target.value)?.displayName ?? ""); }}><option value="">Choose exercise</option>{exercises.map(exercise => <option key={exercise.id} value={exercise.id}>{exercise.displayName}</option>)}</select></label>
    {selected && <><p>{selected.aliases.join(", ") || "No confirmed aliases."}</p><label className="visible-label">Exercise display name<input value={name} disabled={!selected.custom} onChange={event => setName(event.target.value)} /></label><button className="command-button" disabled={!selected.custom || !name.trim()} onClick={() => save("rename")}><Save size={18} />Save name</button>
    <label className="visible-label">New alias<input value={alias} onChange={event => setAlias(event.target.value)} /></label><label className="confirmation-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Confirm alias for {selected.displayName}</label><button className="command-button" disabled={!confirmed || !alias.trim()} onClick={() => save("alias")}><Save size={18} />Save alias</button></>}
    <p role="status">{status}</p></section>;
}
