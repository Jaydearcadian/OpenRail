import { useEffect, useState } from "react";
import { ActivityFeed } from "./dashboard/ActivityFeed";
import { CreatePreview } from "./dashboard/CreatePreview";
import { DashboardSidebar } from "./dashboard/DashboardSidebar";
import { DashboardTopbar } from "./dashboard/DashboardTopbar";
import { InspectModal } from "./dashboard/InspectModal";
import { LifecycleTimeline } from "./dashboard/LifecycleTimeline";
import { PreviewModal } from "./dashboard/PreviewModal";
import { ProofCenter } from "./dashboard/ProofCenter";
import { RailProofModule } from "./dashboard/RailProofModule";
import { SettingsSurface } from "./dashboard/SettingsSurface";
import { StateBlock } from "./dashboard/StateBlock";
import { StatusMatrix } from "./dashboard/StatusMatrix";
import { StreamDetail } from "./dashboard/StreamDetail";
import { SurfaceHeader } from "./dashboard/SurfaceHeader";
import { TrustBoundaryBanner } from "./dashboard/TrustBoundaryBanner";
import { WriteSurface } from "./dashboard/WriteSurface";
import { MetricCard } from "./MetricCard";
import { ReceiptPanel } from "./ReceiptPanel";
import { StreamTable } from "./StreamTable";
import {
  dashboardNav,
  lifecycleSteps,
} from "../data/mock";
import { useMockDashboard } from "../hooks/useMockDashboard";
import type { Metric } from "../data/mock";
import type { StatusMatrixItem } from "../types/dashboard";

interface DashboardShellProps {
  onBack: () => void;
}

export function DashboardShell({ onBack }: DashboardShellProps) {
  const { state, dispatch, routeTitle, selectedStream, live } = useMockDashboard();
  const [search, setSearch] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        document.getElementById("dashboard-search")?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (state.inspect) dispatch({ type: "close-inspect" });
        else if (state.activeModal) dispatch({ type: "close-modal" });
        return;
      }
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing || state.inspect || state.activeModal) return;
      if (event.key === "1") dispatch({ type: "set-route", route: "overview" });
      else if (event.key === "2") dispatch({ type: "set-route", route: "streams" });
      else if (event.key === "3") dispatch({ type: "set-route", route: "receipts" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.inspect, state.activeModal, dispatch]);

  const isScenarioLoading = state.scenario === "loading";
  const isScenarioEmpty = state.scenario === "empty";
  const scenarioError = state.scenario === "error" ? "Scenario preview: this region is showing a recoverable Worker error state." : null;
  const isLoading = live.status === "loading" || isScenarioLoading;
  const error = scenarioError ?? live.error;
  const liveData = !isScenarioLoading && !scenarioError ? live.data : null;
  const streams = isScenarioEmpty ? [] : liveData?.streams ?? [];
  const receipts = isScenarioEmpty ? [] : liveData?.receipts ?? [];
  const metrics: Metric[] = liveData?.metrics ?? [
    {
      label: "Worker status",
      value: isLoading ? "Loading" : error ? "Error" : "Empty",
      helper: "Live stream and receipt data is not displayed until the Worker responds.",
      trend: "OpenRails API",
      tone: error ? "amber" : "blue",
      dominant: true,
    },
  ];
  const statusMatrix: StatusMatrixItem[] = liveData?.statusMatrix ?? [
    { label: "Dashboard mode", state: isLoading ? "Loading" : "Unavailable", detail: "Waiting for deployed Worker stream and receipt responses.", status: error ? "blocked" : "ready" },
    { label: "Receipt index", state: "Live API", detail: "/v1/receipts is the authoritative settlement source.", status: "ready" },
    { label: "Gateway projections", state: "Live API", detail: "/v1/streams/:paycardId returns signed projections.", status: "ready" },
  ];
  const gatewayEvent = liveData?.gatewayEvents.at(-1);

  const query = search.trim().toLowerCase();
  const filteredStreams = !query
    ? streams
    : streams.filter((stream) =>
        [stream.label, stream.id, stream.type, stream.counterparty].some((field) => field.toLowerCase().includes(query)),
      );
  const filteredReceipts = !query
    ? receipts
    : receipts.filter((receipt) =>
        [receipt.label, receipt.digest, receipt.type].some((field) => field.toLowerCase().includes(query)),
      );

  return (
    <main className={`dashboard-app ${state.sidebarCollapsed ? "is-collapsed" : ""}`}>
      <DashboardSidebar
        items={dashboardNav}
        activeRoute={state.route}
        collapsed={state.sidebarCollapsed}
        mobileOpen={mobileNav}
        onBack={onBack}
        onNavigate={() => setMobileNav(false)}
        dispatch={dispatch}
      />
      {mobileNav ? <div className="dash-scrim" role="presentation" onClick={() => setMobileNav(false)} /> : null}
      <section className="dashboard-workspace">
        <DashboardTopbar
          route={state.route}
          title={routeTitle.title}
          web3State={state.web3State}
          search={search}
          onSearch={setSearch}
          onMenu={() => setMobileNav(true)}
          dispatch={dispatch}
        />
        <div className="surface-canvas" key={state.route}>
          <SurfaceHeader eyebrow="OpenRails V1" title={routeTitle.title} description={routeTitle.description}>
            <button type="button" onClick={() => dispatch({ type: "set-route", route: "proof" })}>
              View proof
            </button>
          </SurfaceHeader>
          <TrustBoundaryBanner />
          <StateBlock scenario={state.scenario} title={state.route} />
          {state.route === "overview" ? (
            <>
              <RailProofModule data={liveData ?? undefined} loading={isLoading} error={error} />
              <section className="metrics-grid deep-metrics" aria-label="OpenRails metrics">
                {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
              </section>
              <StreamTable
                streams={filteredStreams.slice(0, 5)}
                selectedId={state.selectedStreamId}
                onSelect={(streamId) => dispatch({ type: "select-stream", streamId })}
                onInspect={(streamId) => dispatch({ type: "open-inspect", target: { kind: "stream", id: streamId } })}
                loading={isLoading}
                error={error}
              />
              <section className="deep-grid">
                <LifecycleTimeline steps={lifecycleSteps} />
                <StatusMatrix items={statusMatrix} />
              </section>
              <section className="deep-grid">
                <ActivityFeed events={liveData?.activityEvents ?? []} onNavigate={dispatch} />
                <ReceiptPanel
                  receipts={filteredReceipts.slice(0, 3)}
                  loading={isLoading}
                  error={error}
                  onInspect={(receiptId) => dispatch({ type: "open-inspect", target: { kind: "receipt", id: receiptId } })}
                />
              </section>
            </>
          ) : null}
          {state.route === "create" ? <CreatePreview dispatch={dispatch} /> : null}
          {state.route === "write" ? <WriteSurface /> : null}
          {state.route === "streams" ? (
            <section className="streams-layout">
              <StreamTable
                streams={filteredStreams}
                selectedId={state.selectedStreamId}
                onSelect={(streamId) => dispatch({ type: "select-stream", streamId })}
                onInspect={(streamId) => dispatch({ type: "open-inspect", target: { kind: "stream", id: streamId } })}
                loading={isLoading}
                error={error}
              />
              <StreamDetail stream={isScenarioEmpty || isLoading || error ? undefined : selectedStream} />
            </section>
          ) : null}
          {state.route === "gateway" ? (
            <section className="deep-grid">
              <section className="panel gateway-panel">
                <div className="panel-heading compact">
                  <span>Projection boundary</span>
                  <h2>Gateway sample heartbeat</h2>
                </div>
                <p>
                  Gateway data is useful for UX and merchant webhooks, but receipts remain
                  authoritative. The values below come from the deployed Worker stream endpoints.
                </p>
                <dl className="detail-grid">
                  <div><dt>Schema</dt><dd>{gatewayEvent?.payload.schemaVersion ?? "pending Worker response"}</dd></div>
                  <div><dt>Signature</dt><dd>{gatewayEvent?.payload.signature ? "present" : "pending Worker response"}</dd></div>
                  <div><dt>Sequence</dt><dd>{gatewayEvent?.sequence ?? "pending Worker response"}</dd></div>
                  <div><dt>Trust boundary</dt><dd>projection only</dd></div>
                </dl>
              </section>
              <LifecycleTimeline steps={lifecycleSteps.filter((step) => step.boundary === "gateway" || step.boundary === "receipt")} />
            </section>
          ) : null}
          {state.route === "receipts" ? (
            <section className="streams-layout">
              <ReceiptPanel
                receipts={filteredReceipts}
                loading={isLoading}
                error={error}
                onInspect={(receiptId) => dispatch({ type: "open-inspect", target: { kind: "receipt", id: receiptId } })}
              />
              <StreamDetail
                stream={isScenarioEmpty || isLoading || error ? undefined : liveData?.streamDetails.find((stream) => stream.receiptDigest) ?? selectedStream}
              />
            </section>
          ) : null}
          {state.route === "proof" ? (
            <ProofCenter proofCards={liveData?.proofCards ?? []} proofs={liveData?.proofs ?? []} loading={isLoading} error={error} />
          ) : null}
          {state.route === "settings" ? <SettingsSurface state={state} dispatch={dispatch} /> : null}
        </div>
      </section>
      <PreviewModal modal={state.activeModal} onClose={() => dispatch({ type: "close-modal" })} />
      <InspectModal
        inspect={state.inspect}
        streams={liveData?.streamDetails ?? []}
        receipts={receipts}
        onClose={() => dispatch({ type: "close-inspect" })}
      />
    </main>
  );
}
