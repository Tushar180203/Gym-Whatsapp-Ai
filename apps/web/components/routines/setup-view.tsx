"use client";
import { useEffect, useState, type FormEvent } from "react";
import { AlarmClock, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, Dumbbell, Layers, LogOut, MessageCircle, Plus, Save, Settings2, Sparkles, X, Zap } from "lucide-react";
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
  const [timeZone, setTimeZone] = useState("UTC"), [memoryEnabled, setMemoryEnabled] = useState(true), [remindersEnabled, setRemindersEnabled] = useState(false);
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
          setTimeZone(profile.timeZone ?? "UTC");
          setMemoryEnabled(profile.conversationMemoryEnabled ?? true);
          setRemindersEnabled(profile.workoutRemindersEnabled ?? false);
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
        displayName,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        conversationMemoryEnabled: memoryEnabled
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
        displayName, timeZone, conversationMemoryEnabled: memoryEnabled, workoutRemindersEnabled: remindersEnabled
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
  const sessionCount = routines.reduce((total, routine) => total + routine.sessions.length, 0);
  const exerciseCount = new Set(routines.flatMap(routine => routine.sessions.flatMap(session => session.exercises.map(exercise => exercise.exerciseIdentityId)))).size;
  function openEditor(routine: ConfiguredRoutine | "new") {
    setEditing(routine);
    setTimeout(() => document.getElementById("routine-builder")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }
  return <>
    <div className="page-intro"><div><p className="eyebrow">MAKE ROOM FOR PROGRESS</p><h1>{authenticated ? (displayName ? `Let’s get to work, ${displayName}.` : "Your next rep starts here.") : "A stronger routine starts here."}</h1><p>{authenticated ? "Your plans, your pace. A little stronger every session." : "Plan on the web. Log on WhatsApp. Keep moving forward."}</p></div>{authenticated && <button className="command-button primary-button" onClick={() => openEditor("new")}><Plus size={17}/>New routine</button>}</div>
    {loading ? <div className="loading-card" role="status"><span className="loading-indicator"/>Getting your training space ready…</div> : !authenticated ? <div className="welcome-grid">
      <section className="welcome-story"><span className="pill"><Zap size={14}/> TRAINING, SIMPLIFIED</span><h2>Show up.<br/>Put in the reps.<br/><em>We’ll keep track.</em></h2><p>A home for your training, from the first set to your next personal best.</p><div className="welcome-benefits"><span><Check size={16}/> Routines that fit your week</span><span><Check size={16}/> Smart exercise suggestions</span><span><Check size={16}/> A workout log on WhatsApp</span></div><div className="welcome-message"><MessageCircle size={20}/><div><small>AS SIMPLE AS A MESSAGE</small><p>“Bench press, 60 kg, 10 reps.”</p></div></div></section>
      <form onSubmit={account} className="setup-form account-form"><div className="form-intro"><span className="feature-icon"><Dumbbell size={23}/></span><h2>Make it your own.</h2><p>Create your account to build your first routine.</p></div><label className="visible-label">Email<input required type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)}/></label><label className="visible-label">Password<input required minLength={12} type="password" autoComplete="new-password" placeholder="At least 12 characters" value={password} onChange={event => setPassword(event.target.value)}/></label><label className="visible-label">Preferred weight unit<select value={unit} onChange={event => setUnit(event.target.value)}><option>KG</option><option>LB</option></select></label><button className="command-button primary-button">Create account <ArrowRight size={17}/></button><p className="form-note">Already have an account? <a href="/login">Sign in</a></p><p className="form-note">Recent chats help your companion understand follow-ups for 30 days (up to 200 messages). You can disable memory and clear it in your profile.</p></form>
    </div> : <>
      <section className="training-hero"><div className="hero-copy"><span className="pill"><span className="status-dot"/> YOUR TRAINING SPACE</span><h2>Build a plan.<br/><em>Find your rhythm.</em></h2><p>Good sessions start with a little structure.<br/>Give your next workout a head start.</p><button className="command-button lime-button" onClick={() => document.getElementById("saved-routines")?.scrollIntoView({ behavior: "smooth" })}>Explore your routines <ArrowUpRight size={17}/></button></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-disc"><Dumbbell size={92} strokeWidth={1.25}/></div><span className="art-label label-top"><Zap size={15}/> One rep at a time</span><span className="art-label label-bottom"><Check size={15}/> Built around you</span><span className="art-cross">+</span></div></section>
      <div className="training-metrics"><div><span className="metric-icon"><Layers size={20}/></span><div><strong>{String(routines.length).padStart(2, "0")}</strong><span>Saved routines</span></div><small>Your training plans</small></div><div><span className="metric-icon"><CalendarDays size={20}/></span><div><strong>{String(sessionCount).padStart(2, "0")}</strong><span>Planned sessions</span></div><small>Ready when you are</small></div><div><span className="metric-icon"><Dumbbell size={20}/></span><div><strong>{String(exerciseCount).padStart(2, "0")}</strong><span>Exercises in your plans</span></div><small>Make every set count</small></div></div>
      <div className="dashboard-grid"><div className="dashboard-main">
        <section className="routines-section" id="saved-routines"><div className="section-heading"><div><p className="eyebrow">THE GAME PLAN</p><h2>Saved routines <span className="count-badge">{routines.length}</span></h2></div><span className="section-note">Made for your pace</span></div><div className="routine-grid">{routines.map((routine, index) => <article className="routine-card" key={routine.id}><div className="routine-card-top"><span className={`routine-symbol tone-${index % 3}`}><Dumbbell size={24}/></span><span className="routine-frequency">{routine.schedule.intendedWorkoutsPerWeek ? `${routine.schedule.intendedWorkoutsPerWeek}× / week` : "Your schedule"}</span></div><button className="routine-title" onClick={() => openEditor(routine)}>{routine.name}</button><p className="routine-session-names">{routine.sessions.map(session => session.name).join(" · ")}</p><div className="routine-card-footer"><span>{routine.sessions.length} sessions <i/> {routine.sessions.reduce((total, session) => total + session.exercises.length, 0)} exercises</span><button className="icon-button" onClick={() => openEditor(routine)} aria-label={`Edit ${routine.name}`}><ArrowUpRight size={18}/></button></div></article>)}<button className="new-routine-card" onClick={() => openEditor("new")}><span><Plus size={23}/></span><strong>{routines.length ? "Room for a new goal" : "Your first routine"}</strong><small>{routines.length ? "Build another routine" : "Start with a session. Make it yours."}</small></button></div></section>
        <WorkoutSelectionControls routines={routines}/>
      </div><aside className="dashboard-aside"><div className="companion-card"><span className="feature-icon"><MessageCircle size={22}/></span><p className="eyebrow">MEET YOUR GYM COMPANION</p><h2>Your workout.<br/>One conversation.</h2><p>Log a set, check your last lift, or finish a session. Just send a message.</p><a href="#whatsapp-heading">Set up WhatsApp <ArrowRight size={16}/></a><div className="chat-example" aria-label="Example workout message"><small>TRY SAYING</small><p>“What’s my workout today?”</p><span><Check size={13}/><Check size={13}/></span></div></div><div className="smart-tip"><Sparkles size={19}/><div><strong>Find your next exercise</strong><p>Try “chest” or “dumbbells” in the routine builder for smart suggestions.</p></div></div></aside></div>
      {editing && <section className="data-band builder-panel" id="routine-builder"><div className="section-heading"><div><p className="eyebrow">MAKE IT YOURS</p><h2>{editing === "new" ? "New routine" : "Edit routine"}</h2></div><button type="button" className="icon-button" aria-label="Close routine editor" onClick={() => setEditing(null)}><X size={18}/></button></div><p className="section-description">Choose your days, build your sessions, and find the exercises that fit.</p><RoutineEditor key={editing === "new" ? "new" : `${editing.id}:${editing.version}`} {...(editing === "new" ? {} : { initial: editing })} onSaved={saved}/></section>}
      <div className="connection-grid"><LinkTokenManager/><ExerciseIdentityControls/></div>
      <details className="profile-settings"><summary><span><Settings2 size={18}/> Profile & preferences</span><ChevronDown size={18}/></summary><form onSubmit={profile} className="setup-form"><div className="setup-grid"><label className="visible-label">Display name<input value={displayName} placeholder="What should we call you?" onChange={event => setDisplayName(event.target.value)}/></label><label className="visible-label">Preferred weight unit<select value={unit} onChange={event => setUnit(event.target.value)}><option>KG</option><option>LB</option></select></label><label className="visible-label">Timezone<input value={timeZone} placeholder="Asia/Kolkata" onChange={event => setTimeZone(event.target.value)}/></label><button type="button" className="command-button" onClick={() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)}>Use device timezone</button></div><div className="reminder-preference"><strong><AlarmClock size={18}/> Your morning nudge</strong><label className="confirmation-check"><input type="checkbox" checked={remindersEnabled} onChange={event => setRemindersEnabled(event.target.checked)}/>Send me a 5:00 AM workout reminder on WhatsApp</label><p className="section-description">At 5:00 AM in {timeZone}, on the planned days in your routines. Connect and verify WhatsApp, choose training days in your routine, and save this preference. After 24 hours without a WhatsApp message from you, reminders may pause until you message again. You can turn it off here anytime. Yeahh buddy, let’s gooo! 💪</p></div><label className="confirmation-check"><input type="checkbox" checked={memoryEnabled} onChange={event => setMemoryEnabled(event.target.checked)}/>Remember recent chats for follow-up questions</label><p className="section-description">Chat memory covers 30 days and up to 200 messages. Turning it off and saving clears saved chats. Workout records stay in your history. Your timezone defines today, yesterday, and weekly totals.</p><div className="data-actions"><button className="command-button primary-button"><Save size={16}/>Save profile</button><button type="button" className="command-button" onClick={async () => { await setupRequest("/api/auth/logout", "POST", {}); setAuthenticated(false); setRoutines([]); setEditing(null); setStatus("Signed out."); }}><LogOut size={16}/>Log out</button></div></form></details>
    </>}
    <p role="status" aria-live="polite" className={status ? "feedback-message" : ""}>{status}</p>
  </>;
}
