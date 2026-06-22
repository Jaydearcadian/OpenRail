import { useEffect, useMemo, useState } from "react";
import { useLiveData } from "../../hooks/useLiveData";
import { useMyStreams } from "../../hooks/useMyStreams";
import type { LiveDashboardData } from "../../data/showcase";
import { Sidebar } from "./Sidebar";
import { Appbar } from "./Appbar";
import { Overview } from "./Overview";
import { WritePanel } from "./WritePanel";
import { ChannelsPanel } from "./ChannelsPanel";
import { RailsPanel } from "./RailsPanel";
import { ReceiptsPanel } from "./ReceiptsPanel";
import { ProofPanel } from "./ProofPanel";
import { NoncePanel } from "./NoncePanel";
import { CredentialsPanel } from "./CredentialsPanel";
import type { ConsoleRoute } from "./routes";

export function ConsoleShell() {
  const live = useLiveData();
  const [route, setRoute] = useState<ConsoleRoute>("overview");
  const [search, setSearch] = useState("");
  const [selectedRail, setSelectedRail] = useState<string | undefined>();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        document.getElementById("console-search")?.focus();
        return;
      }
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      if (event.key === "1") setRoute("overview");
      else if (event.key === "2") setRoute("rails");
      else if (event.key === "3") setRoute("receipts");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigate = (next: ConsoleRoute) => {
    setRoute(next);
    setMobileOpen(false);
  };

  const baseData = live.status === "ready" ? live.data : null;
  const mine = useMyStreams();

  // Merge the connected wallet's own channels (read live from chain) into the
  // Rails/Overview surfaces, ahead of the curated showcase set, deduped by id.
  const data = useMemo<LiveDashboardData | null>(() => {
    if (!baseData) {
      if (mine.streams.length === 0) return null;
      return {
        metrics: [], streams: mine.streams, streamDetails: mine.details, receipts: [],
        activityEvents: [], proofCards: [], proofs: [], statusMatrix: [], gatewayEvents: [], apiBaseUrl: "",
      };
    }
    const seen = new Set(mine.streams.map((s) => s.id.toLowerCase()));
    return {
      ...baseData,
      streams: [...mine.streams, ...baseData.streams.filter((s) => !seen.has(s.id.toLowerCase()))],
      streamDetails: [...mine.details, ...baseData.streamDetails.filter((d) => !seen.has(d.id.toLowerCase()))],
    };
  }, [baseData, mine.streams, mine.details]);

  return (
    <div className="app grid-bg">
      <Sidebar activeRoute={route} mobileOpen={mobileOpen} onNavigate={navigate} />
      {mobileOpen ? <div className="scrim" role="presentation" onClick={() => setMobileOpen(false)} /> : null}
      <div className="main">
        <Appbar
          route={route}
          search={search}
          onSearch={setSearch}
          onMenu={() => setMobileOpen(true)}
          onOpenRail={() => navigate("write")}
        />
        <div className="content" key={route}>
          {route === "overview" ? (
            <Overview
              live={data}
              status={live.status}
              error={live.error}
              search={search}
              onSelectRail={(id) => { setSelectedRail(id); navigate("rails"); }}
            />
          ) : null}
          {route === "write" ? <WritePanel /> : null}
          {route === "channels" ? <ChannelsPanel /> : null}
          {route === "rails" ? (
            <RailsPanel live={data} status={live.status} error={live.error} search={search} selectedId={selectedRail} onSelect={setSelectedRail} onCreate={() => navigate("write")} />
          ) : null}
          {route === "receipts" ? <ReceiptsPanel live={data} status={live.status} error={live.error} search={search} /> : null}
          {route === "proof" ? <ProofPanel live={data} status={live.status} error={live.error} /> : null}
          {route === "nonces" ? <NoncePanel /> : null}
          {route === "credentials" ? <CredentialsPanel /> : null}
        </div>
      </div>
    </div>
  );
}
