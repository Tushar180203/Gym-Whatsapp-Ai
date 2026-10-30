import { cookies } from "next/headers.js";
import { productionApp } from "../../../server/app.js";
import { sessionCookie } from "../../../server/http.js";
import { DomainError } from "../../../../../packages/persistence/src/store.js";
export const dynamic = "force-dynamic";
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = (await searchParams).status;
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return <><h1>Workout History</h1><p role="alert">Authentication required.</p></>;
  const app = productionApp();
  let entries;
  try { entries = await app.history(await app.currentUser(token)); }
  catch (error) { if (error instanceof DomainError && error.code === "UNAUTHENTICATED") return <><h1>Workout History</h1><p role="alert">Authentication required.</p></>; throw error; }
  const filter = ["COMPLETED", "INCOMPLETE"].includes(status ?? "") ? status : undefined;
  const visible = entries.filter(entry => !filter || entry.workout.status === filter).reverse();
  return <><h1>Workout History</h1><nav className="history-filters" aria-label="Workout status"><a aria-current={!filter ? "page" : undefined} href="/history">All</a><a aria-current={filter === "COMPLETED" ? "page" : undefined} href="/history?status=COMPLETED">Completed</a><a aria-current={filter === "INCOMPLETE" ? "page" : undefined} href="/history?status=INCOMPLETE">Incomplete</a></nav>{visible.length ? <ul className="history-list">{visible.map(entry => <li key={entry.workout.id}><a href={`/history/${entry.workout.id}`}><strong>{entry.workout.name}</strong><span>{new Date(entry.workout.trainedAt).toISOString().slice(0,10)} · {entry.workout.status} · {entry.sets.length} sets{entry.workout.durationSeconds !== null ? ` · ${Math.floor(entry.workout.durationSeconds / 60)}m` : ""}</span></a></li>)}</ul> : <p>No saved workouts.</p>}</>;
}
