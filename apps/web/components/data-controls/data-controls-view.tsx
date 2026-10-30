"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation.js";
import { Download, RefreshCw, Trash2, X } from "lucide-react";
import type { DataRequest } from "../../../../packages/persistence/src/data-controls.js";
type Review = { categories: { category: string; count: number }[]; requests: DataRequest[] };
const categoryNames: Record<string, string> = { account: "Account", conversationMemory: "Recent chat memory", profile: "Profile / preferences", links: "WhatsApp links", routines: "Routines", cursors: "Routine sequence", templates: "Session templates", plannedExercises: "Planned exercises", exercises: "Exercise identities", aliases: "Aliases", classifications: "Muscle classifications", workouts: "Workout sessions", sessionExercises: "Session exercises", sets: "Workout sets", corrections: "Corrections" };
const typeNames: Record<string, string> = { EXPORT: "Export", DELETE_ACCOUNT: "Account deletion", DELETE_WORKOUT_DATA: "Workout-data deletion" };
export function DataControlsView({ initialReview }: { initialReview: Review }) {
  const router = useRouter();
  const [review, setReview] = useState(initialReview), [selected, setSelected] = useState<DataRequest | null>(null), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [ready, setReady] = useState(false), [deletedAccount, setDeletedAccount] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), keys = useRef<Record<string, string>>({});
  useEffect(() => setReady(true), []);
  useEffect(() => setReview(initialReview), [initialReview]);
  useEffect(() => { if (selected) { setConfirmed(false); dialog.current?.showModal(); } else dialog.current?.close(); }, [selected]);
  function upsert(result: DataRequest) { setReview(current => ({ ...current, requests: [result, ...current.requests.filter(row => row.id !== result.id)] })); }
  async function execute(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(response.status === 401 ? "Authentication required." : "Request could not be applied. Refresh and try again.");
    return await response.json() as DataRequest;
  }
  async function request(type: string) {
    setBusy(true); setError(""); setMessage("");
    const idempotencyKey = keys.current[type] ??= crypto.randomUUID();
    try {
      const result = await execute(type === "EXPORT" ? "/api/data/export" : "/api/data/delete-request", type === "EXPORT" ? { idempotencyKey } : { idempotencyKey, type });
      upsert(result); delete keys.current[type];
      if (result.status === "AWAITING_CONFIRMATION") setSelected(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); } finally { setBusy(false); }
  }
  async function checkExport(row: DataRequest) {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/data/export/${row.id}`, { cache: "no-store" }); if (!response.ok) throw new Error("Export unavailable. Sign in or refresh."); upsert((await response.json()).request); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Export unavailable."); } finally { setBusy(false); }
  }
  async function confirmDeletion() {
    if (!selected || !confirmed) return;
    setBusy(true); setError("");
    try {
      const result = await execute(`/api/data/delete-request/${selected.id}/confirm`, { confirm: true }); upsert(result); setSelected(null);
      if (result.status === "COMPLETED") {
        if (result.type === "DELETE_ACCOUNT") { setDeletedAccount(true); setMessage("Account deleted. Session invalidated."); }
        else { setMessage("Deletion completed."); router.refresh(); }
      } else setMessage(`${result.status === "EXPIRED" ? "Confirmation expired." : "Stored data changed."} Request deletion again.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Confirmation failed."); } finally { setBusy(false); }
  }
  const pending = review.requests.some(row => row.status === "AWAITING_CONFIRMATION"), disabled = busy || !ready || deletedAccount;
  return <section className="data-controls" aria-label="Data controls" data-ready={ready}>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="error">{error}</p>}
    <div className="data-heading"><h2>Stored Categories</h2><div className="data-actions"><a href="/history">Review / correct history</a><button type="button" className="icon-button" title="Refresh stored data" aria-label="Refresh stored data" disabled={disabled} onClick={() => router.refresh()}><RefreshCw size={18}/></button></div></div>
    <div className="table-shell"><table aria-label="Stored data categories"><thead><tr><th>Category</th><th>Records</th></tr></thead><tbody>{review.categories.map(row => <tr key={row.category}><th>{categoryNames[row.category]}</th><td>{deletedAccount ? 0 : row.count}</td></tr>)}</tbody></table></div>
    <section className="data-band"><h2>Portable Export</h2><button type="button" className="command-button" disabled={disabled} onClick={() => request("EXPORT")}><Download size={18}/>Request export</button></section>
    <section className="data-band danger-band"><h2>Delete Data</h2><p>Workout-data deletion removes recorded workouts from access. Routine templates and preferences remain.</p><p>Account deletion blocks access and disconnects WhatsApp. Both require confirmation.</p><div className="data-actions"><button type="button" className="command-button danger-button" disabled={disabled || pending} onClick={() => request("DELETE_WORKOUT_DATA")}><Trash2 size={18}/>Delete workout data</button><button type="button" className="command-button danger-button" disabled={disabled || pending} onClick={() => request("DELETE_ACCOUNT")}><Trash2 size={18}/>Delete account</button></div></section>
    <section className="data-band"><h2>Requests</h2>{review.requests.length ? <ul className="data-requests">{review.requests.map(row => <li key={row.id}><div><strong>{typeNames[row.type]}</strong><span className="request-status">{row.status.replaceAll("_", " ").toLowerCase()}</span><dl><div><dt>Requested</dt><dd>{new Date(row.requestedAt).toISOString()}</dd></div>{row.expiresAt && <div><dt>Expires</dt><dd>{new Date(row.expiresAt).toISOString()}</dd></div>}{row.confirmedAt && <div><dt>Confirmed</dt><dd>{row.confirmedAt}</dd></div>}{row.completedAt && <div><dt>Completed</dt><dd>{row.completedAt}</dd></div>}</dl>{row.auditSummary.outcome === "COMPLETED" && <p>{String(row.auditSummary.workoutsAffected)} workouts / {String(row.auditSummary.setsAffected)} sets · {row.type === "DELETE_ACCOUNT" ? "Account deleted. Session invalidated." : "Deletion completed."}</p>}</div><div className="data-actions">{row.type === "EXPORT" && !deletedAccount && <><button type="button" className="icon-button" title="Check export status" aria-label="Check export status" disabled={disabled} onClick={() => checkExport(row)}><RefreshCw size={18}/></button>{row.status === "COMPLETED" && row.resultLocation && <a className="command-button" href={row.resultLocation}><Download size={18}/>Download export</a>}</>}{row.status === "AWAITING_CONFIRMATION" && <button type="button" className="command-button danger-button" disabled={disabled} onClick={() => setSelected(row)}><Trash2 size={18}/>Review confirmation</button>}</div></li>)}</ul> : <p>No data-control requests.</p>}</section>
    <dialog ref={dialog} onCancel={() => setSelected(null)} aria-labelledby="deletion-title" className="deletion-dialog"><div className="data-heading"><h2 id="deletion-title">Confirm {selected?.type === "DELETE_ACCOUNT" ? "Account" : "Workout-Data"} Deletion</h2><button type="button" className="icon-button" title="Close confirmation" aria-label="Close confirmation" disabled={busy} onClick={() => setSelected(null)}><X size={18}/></button></div><p>{selected?.type === "DELETE_ACCOUNT" ? "Your account will become inaccessible and all sessions will be invalidated." : "All recorded workout sessions and sets, including active workouts, will become inaccessible."}</p><label className="confirmation-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>I explicitly confirm this deletion.</label>{error && <p role="alert" className="error">{error}</p>}<button type="button" className="command-button danger-button" disabled={!confirmed || busy} onClick={confirmDeletion}><Trash2 size={18}/>Confirm deletion</button></dialog>
  </section>;
}
