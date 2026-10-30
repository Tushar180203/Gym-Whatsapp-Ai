"use client";
import { RefreshCw } from "lucide-react";
export default function DataError({ reset }: { reset: () => void }) { return <section><h1>Stored Data</h1><p role="alert">Stored data unavailable.</p><button type="button" className="icon-button" title="Retry stored data" aria-label="Retry stored data" onClick={reset}><RefreshCw size={18}/></button></section>; }
