"use client";
import { useState } from "react";
import { Play, Pause, RefreshCw, Check } from "lucide-react";
import type { ConfiguredRoutine } from "../../../../packages/persistence/src/configuration.js";
import { setupRequest } from "./routine-editor.js";
type Result = { body: string; workout: { id: string; name: string; status: string; version: number } | null; confirmationId?: string };
export function WorkoutSelectionControls({ routines }: { routines: ConfiguredRoutine[] }) {
  const [sessionRef, setSessionRef] = useState(""), [result, setResult] = useState<Result | null>(null), [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  async function choose(kind: "START" | "ACCEPT" | "CHOOSE" | "REST" | "REPLACE" | "CONFIRM") {
    setBusy(true);
    try {
      const input = { kind, idempotencyKey: crypto.randomUUID(), ...(kind === "START" || kind === "CHOOSE" || kind === "REPLACE" ? sessionRef ? { sessionRef } : {} : {}),
        ...(["ACCEPT", "CHOOSE", "REST", "REPLACE"].includes(kind) ? { workoutId: result?.workout?.id, expectedVersion: result?.workout?.version } : {}), ...(kind === "CONFIRM" ? { confirmationId: result?.confirmationId } : {}) };
      const next = await setupRequest<Result>("/api/workouts/start", "POST", input); setResult(next); setStatus(next.body);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Workout unavailable."); } finally { setBusy(false); }
  }
  async function lifecycle(intent: "RESUME" | "REQUEST" | "INCOMPLETE" | "DISCARD") {
    if (!result?.workout) return;
    setBusy(true);
    try {
      const path = intent === "RESUME" ? "resume" : intent === "DISCARD" ? "discard" : "finish";
      const response = await setupRequest<{ body: string }>(`/api/workouts/${result.workout.id}/${path}`, "POST", { idempotencyKey: crypto.randomUUID(), ...(path === "finish" && intent !== "REQUEST" ? { requestedCompletion: intent } : {}) });
      setStatus(response.body);
      const workout = await setupRequest<Result["workout"]>("/api/workouts/active"); setResult({ body: response.body, workout });
    } catch (error) { setStatus(error instanceof Error ? error.message : "Workout unavailable."); } finally { setBusy(false); }
  }
  return <section className="data-band"><h2>Workout selection</h2><label className="visible-label">Workout session<select value={sessionRef} onChange={event => setSessionRef(event.target.value)}><option value="">Next from normal sequence</option>{routines.flatMap(routine => routine.sessions.map(session => <option key={session.id} value={session.id}>{routine.name}: {session.name}</option>))}</select></label>
    <div className="data-actions"><button className="command-button" disabled={busy} onClick={() => choose("START")}><Play size={18} />Propose workout</button>
    {result?.workout?.status === "PROPOSED" && <><button className="command-button" disabled={busy} onClick={() => choose("ACCEPT")}><Check size={18} />Start planned</button><button className="command-button" disabled={busy || !sessionRef} onClick={() => choose("CHOOSE")}><RefreshCw size={18} />Choose for today</button><button className="command-button" disabled={busy} onClick={() => choose("REST")}><Pause size={18} />Rest</button></>}
    {result?.workout && result.workout.status !== "PROPOSED" && <><button className="command-button" disabled={busy} onClick={() => lifecycle("RESUME")}>Resume</button><button className="command-button" disabled={busy} onClick={() => lifecycle("REQUEST")}>Finish</button><button className="command-button" disabled={busy} onClick={() => lifecycle("INCOMPLETE")}>Save incomplete</button><button className="command-button danger-button" disabled={busy} onClick={() => lifecycle("DISCARD")}>Discard</button><button className="command-button danger-button" disabled={busy || !sessionRef} onClick={() => choose("REPLACE")}><RefreshCw size={18} />Replace workout</button></>}
    {result?.confirmationId && <button className="command-button danger-button" disabled={busy} onClick={() => choose("CONFIRM")}><Check size={18} />Confirm replacement</button>}</div><p role="status" className="workout-summary">{status}</p></section>;
}
