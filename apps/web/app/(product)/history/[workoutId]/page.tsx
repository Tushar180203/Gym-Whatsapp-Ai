import { cookies } from "next/headers.js";
import { notFound } from "next/navigation.js";
import { productionApp } from "../../../../server/app.js";
import { sessionCookie } from "../../../../server/http.js";
import { DomainError } from "../../../../../../packages/persistence/src/store.js";
import { EditWorkoutForm } from "../../../../components/history/edit-workout-form.js";
export const dynamic = "force-dynamic";
export default async function WorkoutPage({ params }: { params: Promise<{ workoutId: string }> }) {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return <><h1>Workout History</h1><p role="alert">Authentication required.</p></>;
  try {
    const history = await productionApp().historyDetails(token, (await params).workoutId);
    return <><a className="back" href="/history">Back to history</a><h1>{history.workout.name}</h1><p className="status">{history.workout.status}</p><p className="workout-summary">{history.summary}</p><EditWorkoutForm initialHistory={history}/></>;
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    if (error instanceof DomainError && error.code === "UNAUTHENTICATED") return <><h1>Workout History</h1><p role="alert">Authentication required.</p></>;
    throw error;
  }
}
