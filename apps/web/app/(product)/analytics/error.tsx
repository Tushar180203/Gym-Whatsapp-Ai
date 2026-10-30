"use client";
import { RefreshCw } from "lucide-react";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <><h1>Analytics</h1><p role="alert">Analytics unavailable.</p><button type="button" className="icon-button" onClick={reset} aria-label="Retry analytics" title="Retry analytics"><RefreshCw size={18}/></button></>;
}
