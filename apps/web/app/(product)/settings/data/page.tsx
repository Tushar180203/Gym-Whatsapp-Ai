import { cookies } from "next/headers.js";
import { productionApp } from "../../../../server/app.js";
import { sessionCookie } from "../../../../server/http.js";
import { DomainError } from "../../../../../../packages/persistence/src/store.js";
import { DataControlsView } from "../../../../components/data-controls/data-controls-view.js";
export const dynamic = "force-dynamic";
export default async function DataPage() {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return <><h1>Stored Data</h1><p role="alert">Authentication required.</p></>;
  try { return <><h1>Stored Data</h1><DataControlsView initialReview={await productionApp().dataReview(token)}/></>; }
  catch (error) { if (error instanceof DomainError && error.code === "UNAUTHENTICATED") return <><h1>Stored Data</h1><p role="alert">Authentication required.</p></>; throw error; }
}
