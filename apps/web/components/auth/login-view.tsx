"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, Dumbbell } from "lucide-react";
import { setupRequest } from "../routines/routine-editor.js";
export function LoginView() {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setStatus("");
    try {
      await setupRequest("/api/auth/login", "POST", { email, password });
      window.location.assign("/routines");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sign in unavailable."); setBusy(false);
    }
  }
  return <>
    <div className="page-intro"><div><p className="eyebrow">WELCOME BACK</p><h1>Pick up where you left off.</h1><p>Sign in to see your routines, history and analytics.</p></div></div>
    <div className="welcome-grid">
      <form onSubmit={signIn} className="setup-form account-form">
        <div className="form-intro"><span className="feature-icon"><Dumbbell size={23}/></span><h2>Sign in</h2><p>Use the email and password you signed up with.</p></div>
        <label className="visible-label">Email<input required type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)}/></label>
        <label className="visible-label">Password<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)}/></label>
        <button className="command-button primary-button" disabled={busy}>Sign in <ArrowRight size={17}/></button>
        {status && <p role="alert" className="form-note">{status}</p>}
        <p className="form-note">New here? <a href="/onboarding">Create an account</a></p>
      </form>
    </div>
  </>;
}
