"use client";
import { useEffect, useId, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import type { ConfiguredExercise } from "../../../../packages/persistence/src/configuration.js";

export function ExercisePicker({ exercises, value, onChange, onSuggestNew }: { exercises: ConfiguredExercise[]; value: string; onChange: (id: string) => void; onSuggestNew: (name: string) => void }) {
  const selected = exercises.find(item => item.id === value);
  const [query, setQuery] = useState(selected?.displayName ?? ""), [open, setOpen] = useState(false), [aiIds, setAiIds] = useState<string[]>([]), [ai, setAi] = useState(false), [names, setNames] = useState<string[]>([]), [unavailable, setUnavailable] = useState(false), [loading, setLoading] = useState(false);
  const id = useId();
  const [active, setActive] = useState(-1);
  useEffect(() => { if (selected) setQuery(selected.displayName); }, [selected?.displayName, value]);
  useEffect(() => {
    setAiIds([]); setNames([]); setAi(false); setUnavailable(false);
    if (!open || query.trim().length < 2 || query === selected?.displayName) { setLoading(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/exercises/suggest?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : Promise.reject())
        .then(data => { setAiIds(Array.isArray(data.ids) ? data.ids : []); setNames(Array.isArray(data.names) ? data.names : []); setAi(data.ai); setUnavailable(!data.ai); })
        .catch(() => { if (!controller.signal.aborted) setUnavailable(true); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, open, selected?.displayName]);
  const needle = query.trim().toLowerCase();
  const matches = exercises.filter(item => !needle || [item.displayName, ...item.aliases].some(text => text.toLowerCase().includes(needle)));
  const results = [...new Map([...matches, ...aiIds.map(id => exercises.find(item => item.id === id)).filter((item): item is ConfiguredExercise => Boolean(item))].map(item => [item.id, item])).values()].slice(0, 12);
  return <div className="exercise-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}><label className="visible-label" htmlFor={id}>Exercise</label><div className="search-input"><Search size={17} aria-hidden="true"/><input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={open && active >= 0 && results[active] ? `${id}-option-${active}` : undefined} autoComplete="off" placeholder="Search exercise, muscle or equipment" value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); onChange(""); setActive(-1); setOpen(true); }} onKeyDown={event => { if (event.key === "Escape") setOpen(false); if (event.key === "ArrowDown" && results.length) { event.preventDefault(); setOpen(true); setActive(current => Math.min(current + 1, results.length - 1)); } if (event.key === "ArrowUp" && results.length) { event.preventDefault(); setActive(current => Math.max(current - 1, 0)); } if (event.key === "Enter" && open && active >= 0 && results[active]) { event.preventDefault(); const item = results[active]; onChange(item.id); setQuery(item.displayName); setOpen(false); } }} /></div>
    {open && <div className="picker-results" id={`${id}-list`} role="listbox"><div className="picker-caption"><Sparkles size={14}/> {loading ? "Finding suggestions…" : ai ? "Smart suggestions" : "Exercise library"}</div>{results.map((item, index) => <button id={`${id}-option-${index}`} type="button" role="option" aria-selected={value === item.id} key={item.id} onClick={() => { onChange(item.id); setQuery(item.displayName); setOpen(false); }}><span>{item.displayName}</span><small>{item.custom ? "Custom" : "Exercise"}</small></button>)}{names.map(name => <button type="button" key={name} onClick={() => { onSuggestNew(name); setOpen(false); }}><span>{name}</span><small>New exercise +</small></button>)}{!results.length && !names.length && !loading && <p>No matches yet. Try another name or create a custom exercise below.</p>}{unavailable && <p>AI suggestions are unavailable right now. You can still search your library or create a custom exercise below.</p>}</div>}
  </div>;
}
