import React from "react";
import { createRoot } from "react-dom/client";
import { AnalyticsView } from "../../../apps/web/components/analytics/analytics-view.js";
import { workoutAnalytics } from "../../../packages/analytics/src/workout-analytics-service.js";
import { recorded } from "../../../packages/analytics/src/testing/recorded-set.js";
import "../../../apps/web/app/styles.css";
const identities = [
  { id: "bench", name: "Barbell Bench Press" }, { id: "row", name: "Seated Cable Row" },
  { id: "squat", name: "Barbell Squat" }, { id: "rdl", name: "Romanian Deadlift" },
  { id: "curl", name: "Hammer Curl" }, { id: "raise", name: "Lateral Raise" },
  { id: "unknown", name: "Custom cable movement" }
];
const workouts = [
  { id: "w1", userId: "user", templateId: "t", name: "Push day", status: "COMPLETED", trainedAt: new Date("2026-10-26T08:00:00Z") },
  { id: "w2", userId: "user", templateId: "t", name: "Leg day", status: "COMPLETED", trainedAt: new Date("2026-10-27T08:00:00Z") },
  { id: "w3", userId: "user", templateId: "t", name: "Pull day", status: "INCOMPLETE", trainedAt: new Date("2026-10-29T08:00:00Z") },
  ...Array.from({ length: 7 }, (_, i) => ({ id: `old${i}`, userId: "user", templateId: "t", name: "Push day", status: "COMPLETED", trainedAt: new Date(`2026-10-${String(3 + i * 3).padStart(2, "0")}T08:00:00Z`) }))
];
const sets = identities.flatMap((identity, index) => Array.from({ length: index === 0 ? 6 : 3 }, (_, i) => recorded({
  id: `${identity.id}-${i}`, exerciseIdentityId: identity.id, workoutId: index === 0 || index === 5 ? "w1" : index === 2 || index === 3 ? "w2" : "w3", loadValue: 20 + index * 5, weightUnit: "KG", loadSemantics: "TOTAL_LOAD", setIndex: i + 1, reps: 10
}))).concat(Array.from({ length: 7 }, (_, i) => recorded({ id: `oldset${i}`, exerciseIdentityId: "bench", workoutId: `old${i}`, weightUnit: "KG", loadSemantics: "TOTAL_LOAD", loadValue: 10 + i, reps: 10 })));
const classifications = [{ userId: "user", exerciseIdentityId: "bench", muscleGroup: "Chest", role: "PRIMARY", status: "CONFIRMED" }];
const empty = new URLSearchParams(location.search).has("empty");
const data = { ...workoutAnalytics({ userId: "user", now: new Date("2026-10-29T12:00:00Z"), timeZone: "Asia/Kolkata", workouts: empty ? [] : workouts, sets: empty ? [] : sets, classifications }), identities, classifications: empty ? [] : classifications };
createRoot(document.getElementById("root")!).render(<div className="app-shell"><aside className="sidebar"><a className="brand" href="/">Workout<span className="brand-subtitle">COMPANION</span></a><div className="nav-label">YOUR WORKSPACE</div><nav><a href="/routines">My routines</a><a href="/history">Workout history</a><a href="/analytics" aria-current="page">Progress & insights</a></nav></aside><div className="app-workspace"><header className="workspace-header"><div className="breadcrumb">Workspace › <span>Progress & insights</span></div></header><main><AnalyticsView initialData={data}/></main></div></div>);
