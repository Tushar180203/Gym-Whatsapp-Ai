"use client";
import { useEffect, useState } from "react";
import { Link, Unlink } from "lucide-react";
import { setupRequest } from "../routines/routine-editor.js";
export function LinkTokenManager() {
  const [links, setLinks] = useState<Array<{ id: string; revokedAt: string | null }>>([]), [token, setToken] = useState(""), [expiresAt, setExpiresAt] = useState(""), [status, setStatus] = useState("");
  const load = () => setupRequest<typeof links>("/api/whatsapp/link").then(setLinks);
  useEffect(() => { load().catch(error => setStatus(error.message)); }, []);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => { setToken(""); setExpiresAt(""); setStatus("Link token expired."); }, Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);
  async function generate() { try { const result = await setupRequest<{ token: string; expiresAt: string }>("/api/whatsapp/link-token", "POST", {}); setToken(result.token); setExpiresAt(result.expiresAt); setStatus("Link token created."); } catch (error) { setStatus(error instanceof Error ? error.message : "Request failed."); } }
  async function revoke(id: string) { try { await setupRequest(`/api/whatsapp/link/${id}`, "DELETE"); await load(); setStatus("Link revoked."); } catch (error) { setStatus(error instanceof Error ? error.message : "Request failed."); } }
  return <section className="data-band"><h2>WhatsApp link</h2><p>{links.some(link => !link.revokedAt) ? "Linked" : "Not linked"}</p><button className="command-button" onClick={generate}><Link size={18} />Generate link token</button>{token && <output className="link-token">link {token}</output>}{links.filter(link => !link.revokedAt).map(link => <button key={link.id} className="command-button danger-button" onClick={() => revoke(link.id)}><Unlink size={18} />Revoke link</button>)}<p role="status">{status}</p></section>;
}
