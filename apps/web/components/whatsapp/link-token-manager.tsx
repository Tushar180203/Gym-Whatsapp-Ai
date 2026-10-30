"use client";
import { useEffect, useState } from "react";
import { Link, RefreshCw, Unlink } from "lucide-react";
import { setupRequest } from "../routines/routine-editor.js";
type LinkStatus = { status: string; verified: { id: string; maskedNumber: string | null } | null; pending: { id: string; maskedNumber: string; expiresAt: string; change: boolean } | null };
export function LinkTokenManager() {
  const [link, setLink] = useState<LinkStatus | null>(null), [phone, setPhone] = useState(""), [consent, setConsent] = useState(false);
  const [challenge, setChallenge] = useState<{ token: string; whatsappUrl: string; expiresAt: string } | null>(null);
  const [changing, setChanging] = useState(false), [status, setStatus] = useState(""), [busy, setBusy] = useState(false), [now, setNow] = useState(Date.now());
  const load = () => setupRequest<LinkStatus>("/api/whatsapp/link").then(value => { setLink(value); return value; });
  useEffect(() => { load().catch(error => setStatus(error.message)); }, []);
  useEffect(() => {
    if (!link?.pending) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      load().then(value => {
        if (!value.pending) {
          setChallenge(null); setChanging(false);
          if (value.verified && value.verified.id !== link.verified?.id) { setPhone(""); setConsent(false); setStatus("Verification completed."); }
        }
      }).catch(() => setStatus("Could not refresh verification status."));
    }, 5000);
    return () => clearInterval(timer);
  }, [link?.pending?.id]);
  useEffect(() => {
    if (!challenge) return;
    const timer = setTimeout(() => { setChallenge(null); setStatus("Verification code expired. Generate a new one."); load().catch(() => {}); }, Math.max(0, Date.parse(challenge.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [challenge]);
  async function generate(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const result = await setupRequest<NonNullable<typeof challenge>>("/api/whatsapp/link-token", "POST", { phoneNumber: phone, consent, change: changing });
      setChallenge(result); await load(); setStatus("Waiting for WhatsApp verification.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not create verification. Check the number and country code."); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!link?.verified || !window.confirm("Disconnect WhatsApp? Workout messages from this number will stop.")) return;
    setBusy(true);
    try { await setupRequest(`/api/whatsapp/link/${link.verified.id}`, "DELETE", { confirm: true }); setChallenge(null); setChanging(false); await load(); setStatus("WhatsApp disconnected."); }
    catch { setStatus("Could not disconnect WhatsApp."); } finally { setBusy(false); }
  }
  const pending = link?.pending;
  return <section className="data-band" aria-labelledby="whatsapp-heading">
    <h2 id="whatsapp-heading">WhatsApp</h2>
    <p>{link?.verified ? "WhatsApp connected" : pending ? "Waiting for WhatsApp verification" : link?.status === "REVOKED" ? "WhatsApp disconnected" : "Connect WhatsApp"}</p>
    {link?.verified && <><p>{link.verified.maskedNumber ?? "Verified WhatsApp account"}</p><div className="data-actions">
      <button className="command-button" disabled={busy} onClick={() => { setChanging(true); setPhone(""); setConsent(false); }}><RefreshCw size={18} />Change WhatsApp number</button>
      <button className="command-button danger-button" disabled={busy} onClick={revoke}><Unlink size={18} />Disconnect WhatsApp</button></div></>}
    {(!link?.verified || changing) && <form onSubmit={generate} className="setup-form">
      <label htmlFor="whatsapp-number" className="visible-label">WhatsApp phone number</label>
      <input id="whatsapp-number" type="tel" autoComplete="tel" value={phone} required maxLength={64} pattern="\+[0-9 \(\)\-]+" title="Include + and the country code" placeholder="+91 96857 19847" onChange={event => setPhone(event.target.value)} />
      <label className="confirmation-check"><input type="checkbox" checked={consent} required onChange={event => setConsent(event.target.checked)} /> I want to use WhatsApp to receive and log my workouts.</label>
      <button type="submit" className="command-button" disabled={busy || !consent}><Link size={18} />{pending ? "Generate new verification" : "Verify on WhatsApp"}</button>
    </form>}
    {pending && <p>Verification for {pending.maskedNumber} expires in {Math.max(0, Math.ceil((Date.parse(pending.expiresAt) - now) / 60000))} minutes.</p>}
    {challenge && <><h3>Verify your WhatsApp</h3><a className="command-button" href={challenge.whatsappUrl} target="_blank" rel="noopener noreferrer"><Link size={18} />Open WhatsApp</a><p>Send this message to our WhatsApp number:</p><output className="link-token">LINK {challenge.token}</output></>}
    <p role="status" aria-live="polite">{status}</p>
  </section>;
}
