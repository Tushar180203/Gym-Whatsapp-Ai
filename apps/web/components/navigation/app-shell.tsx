"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation.js";
import { ArrowUpRight, ChartNoAxesCombined, ChevronRight, Dumbbell, History, LayoutGrid, MessageCircle, ShieldCheck, Zap } from "lucide-react";

const navigation = [
  { href: "/routines", label: "My routines", icon: LayoutGrid },
  { href: "/history", label: "Workout history", icon: History },
  { href: "/analytics", label: "Progress & insights", icon: ChartNoAxesCombined },
  { href: "/settings/data", label: "Privacy & data", icon: ShieldCheck }
];
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = navigation.find(item => pathname.startsWith(item.href));
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <a className="brand" href="/routines" aria-label="Workout Companion home"><span className="brand-mark"><Dumbbell size={23} strokeWidth={2.4}/></span><span>Workout<span className="brand-subtitle">COMPANION</span></span></a>
      <div className="nav-label">YOUR WORKSPACE</div>
      <nav aria-label="Product">{navigation.map(({ href, label, icon: Icon }) => <a key={href} href={href} aria-label={label} title={label} aria-current={current?.href === href ? "page" : undefined}><Icon size={19}/><span>{label}</span>{current?.href === href && <span className="nav-dot"/>}</a>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-tip"><MessageCircle size={22}/><strong>Less tapping.<br/>More training.</strong><p>Your workout log is a WhatsApp message away.</p><a href="/routines#whatsapp-heading">Connect WhatsApp <ArrowUpRight size={16}/></a></div><div className="sidebar-signature"><span className="status-dot"/> Built for your next rep.</div></div>
    </aside>
    <div className="app-workspace"><header className="workspace-header"><div className="breadcrumb">Workspace <ChevronRight size={14}/><span>{current?.label ?? "Get started"}</span></div><a className="header-shortcut" href="/routines"><Zap size={14}/> Your training hub</a></header><main id="main-content">{children}</main><footer className="workspace-footer"><span>WORKOUT COMPANION</span><span>Small steps. Stronger every day.</span></footer></div>
  </div>;
}
