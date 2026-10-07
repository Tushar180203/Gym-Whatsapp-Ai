import { cookies } from "next/headers.js";
import { productionApp } from "../../../server/app.js";
import { sessionCookie } from "../../../server/http.js";
import { DomainError } from "../../../../../packages/persistence/src/store.js";
export const dynamic = "force-dynamic";
export default async function HistoryPage() {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return <><h1>Workout History</h1><p role="alert">Authentication required.</p></>;
  const app = productionApp();
  let entries;
  try { entries = await app.history(await app.currentUser(token)); }
  catch (error) { if (error instanceof DomainError && error.code === "UNAUTHENTICATED") return <><h1>Workout History</h1><p role="alert">Authentication required.</p></>; throw error; }
  return <><h1>Workout History</h1>{entries.length ? <ul className="history-list">{entries.map(entry => <li key={entry.workout.id}><a href={`/history/${entry.workout.id}`}><strong>{entry.workout.name}</strong><span>{entry.workout.status} · {entry.sets.length} sets</span></a></li>)}</ul> : <p>No completed workouts.</p>}</>;
}
