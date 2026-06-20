import { useState } from "react";
import { DashboardShell } from "./components/DashboardShell";
import { LandingPage } from "./components/LandingPage";

export default function App() {
  const [view, setView] = useState<"landing" | "dashboard">("landing");

  return view === "landing"
    ? <LandingPage onLaunch={() => setView("dashboard")} />
    : <DashboardShell onBack={() => setView("landing")} />;
}
