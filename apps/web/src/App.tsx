import { useEffect, useState } from "react";
import { ConsoleShell } from "./components/console/ConsoleShell";
import { RailView } from "./components/RailView";
import { parseLocation, type RailTarget } from "./lib/raillink";

export default function App() {
  const [target, setTarget] = useState<RailTarget | null>(() => parseLocation());

  useEffect(() => {
    const onNav = () => setTarget(parseLocation());
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  if (target) return <RailView target={target} />;
  return <ConsoleShell />;
}
