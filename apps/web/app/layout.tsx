import type { ReactNode } from "react";
import { AppShell } from "../components/navigation/app-shell.js";
import "./styles.css";
export const metadata = { title: "Workout Companion", description: "Plan your workouts, log them on WhatsApp, and see your progress." };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><AppShell>{children}</AppShell></body></html>;
}
