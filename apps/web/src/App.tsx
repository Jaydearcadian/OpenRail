import { useEffect, useState } from "react";
import { ConsoleShell } from "./components/console/ConsoleShell";
import { RailView } from "./components/RailView";
import { Landing } from "./components/Landing";
import { parseLocation, type RailTarget } from "./lib/raillink";

function isConsolePath(): boolean {
  return typeof window !== "undefined" && window.location.pathname.replace(/\/$/, "") === "/app";
}

export default function App() {
  const [target, setTarget] = useState<RailTarget | null>(() => parseLocation());
  const [onConsole, setOnConsole] = useState<boolean>(() => isConsolePath());

  useEffect(() => {
    const onNav = () => { setTarget(parseLocation()); setOnConsole(isConsolePath()); };
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  const launch = () => {
    window.history.pushState({}, "", "/app");
    setOnConsole(true);
  };

  if (target) return <RailView target={target} />;
  if (onConsole) return <ConsoleShell />;
  return <Landing onLaunch={launch} />;
}
