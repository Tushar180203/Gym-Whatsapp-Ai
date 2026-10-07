import type { ReactNode } from "react";
import "./styles.css";
export const metadata = { title: "Workout Companion" };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><header className="brand"><span className="brand-mark">W</span><span>Workout Companion</span><a href="/history">History</a></header><main>{children}</main></body></html>;
}
