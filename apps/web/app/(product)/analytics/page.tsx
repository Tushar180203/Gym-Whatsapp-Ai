import { cookies } from "next/headers.js";
import { productionApp } from "../../../server/app.js";
import { sessionCookie } from "../../../server/http.js";
import { DomainError } from "../../../../../packages/persistence/src/store.js";
import { AnalyticsView } from "../../../components/analytics/analytics-view.js";
export const dynamic = "force-dynamic";
export default async function AnalyticsPage() {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return <><h1>Analytics</h1><p role="alert">Authentication required.</p></>;
  try { return <><h1>Analytics</h1><AnalyticsView initialData={await productionApp().analytics(token)}/></>; }
  catch (error) {
    if (error instanceof DomainError && error.code === "UNAUTHENTICATED") return <><h1>Analytics</h1><p role="alert">Authentication required.</p></>;
    if (error instanceof DomainError && error.code === "PROFILE_REQUIRED") return <><h1>Analytics</h1><p role="alert">Preferred weight unit required.</p></>;
    throw error;
  }
}
