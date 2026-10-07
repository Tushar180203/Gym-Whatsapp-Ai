"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, Save, LogOut } from "lucide-react";
import type { ConfiguredRoutine } from "../../../../packages/persistence/src/configuration.js";
import { RoutineEditor, setupRequest } from "./routine-editor.js";
import { ExerciseIdentityControls } from "./exercise-identity-controls.js";
import { LinkTokenManager } from "../whatsapp/link-token-manager.js";
import { WorkoutSelectionControls } from "./workout-selection-controls.js";
export function SetupView({ onboarding = false }: { onboarding?: boolean }) {
  const [authenticated, setAuthenticated] = useState(false),
    [loading, setLoading] = useState(true),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [unit, setUnit] = useState("KG"),
    [displayName, setDisplayName] = useState(""),
    [status, setStatus] = useState(""),
    [routines, setRoutines] = useState<ConfiguredRoutine[]>([]),
    [editing, setEditing] = useState<ConfiguredRoutine | "new" | null>(null);
  const loadRoutines = () =>
    setupRequest<ConfiguredRoutine[]>("/api/routines").then(setRoutines);
  useEffect(() => {
    fetch("/api/profile")
      .then(async (response) => {
        if (response.ok) {
          const profile = await response.json();
          setAuthenticated(true);
          setUnit(profile.preferredWeightUnit);
          setDisplayName(profile.displayName ?? "");
          await loadRoutines();
        }
      })
      .catch(() => setStatus("Setup unavailable."))
      .finally(() => setLoading(false));
  }, []);
  async function account(event: FormEvent) {
    event.preventDefault();
    try {
      await setupRequest("/api/auth/signup", "POST", { email, password });
      await setupRequest("/api/profile", "PATCH", {
        preferredWeightUnit: unit,
        displayName
      });
      setAuthenticated(true);
      setPassword("");
      setEditing("new");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Account unavailable."
      );
    }
  }
  async function profile(event: FormEvent) {
    event.preventDefault();
    try {
      await setupRequest("/api/profile", "PATCH", {
        preferredWeightUnit: unit,
        displayName
      });
      setStatus("Profile saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed.");
    }
  }
  async function saved() {
    await loadRoutines();
    setEditing(null);
    setStatus("Routine saved.");
  }
  return (
    <>
      <h1>{onboarding ? "Account Setup" : "Routines"}</h1>
      {loading ? (
        <p role="status">Loading...</p>
      ) : !authenticated ? (
        <form onSubmit={account} className="setup-form">
          <label className="visible-label">
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="visible-label">
            Password
            <input
              required
              minLength={12}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="visible-label">
            Preferred weight unit
            <select
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            >
              <option>KG</option>
              <option>LB</option>
            </select>
          </label>
          <button className="command-button">Create account</button>
        </form>
      ) : (
        <>
          <form onSubmit={profile} className="setup-form">
            <div className="setup-grid">
              <label className="visible-label">
                Display name
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label className="visible-label">
                Preferred weight unit
                <select
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                >
                  <option>KG</option>
                  <option>LB</option>
                </select>
              </label>
            </div>
            <button className="command-button">
              <Save size={18} />
              Save profile
            </button>
          </form>
          <section className="data-band">
            <h2>Saved routines</h2>
            <ul className="history-list">
              {routines.map((routine) => (
                <li key={routine.id}>
                  <button
                    className="command-button"
                    onClick={() => setEditing(routine)}
                  >
                    {routine.name}
                  </button>
                  <p>
                    {routine.sessions
                      .map((session) => session.name)
                      .join(" / ")}
                  </p>
                </li>
              ))}
            </ul>
            <button
              className="command-button"
              onClick={() => setEditing("new")}
            >
              <Plus size={18} />
              New routine
            </button>
          </section>
          {editing && (
            <section className="data-band">
              <h2>{editing === "new" ? "New routine" : "Edit routine"}</h2>
              <RoutineEditor
                key={
                  editing === "new" ? "new" : `${editing.id}:${editing.version}`
                }
                {...(editing === "new" ? {} : { initial: editing })}
                onSaved={saved}
              />
            </section>
          )}
          <WorkoutSelectionControls routines={routines} /><ExerciseIdentityControls />
          <LinkTokenManager />
          <button
            className="command-button"
            onClick={async () => {
              await setupRequest("/api/auth/logout", "POST", {});
              setAuthenticated(false);
              setRoutines([]);
              setStatus("Signed out.");
            }}
          >
            <LogOut size={18} />
            Log out
          </button>
        </>
      )}
      <p role="status" aria-live="polite">
        {status}
      </p>
    </>
  );
}
