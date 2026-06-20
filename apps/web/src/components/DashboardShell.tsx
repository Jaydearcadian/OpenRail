import { ActivityFeed } from "./dashboard/ActivityFeed";
import { CreatePreview } from "./dashboard/CreatePreview";
import { DashboardSidebar } from "./dashboard/DashboardSidebar";
import { DashboardTopbar } from "./dashboard/DashboardTopbar";
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

  return (
    <main className="dashboard-app">
      <DashboardSidebar
        items={dashboardNav}
        activeRoute={state.route}
        collapsed={state.sidebarCollapsed}
        onBack={onBack}
        dispatch={dispatch}
      />
      <section className="dashboard-workspace">
        <DashboardTopbar
          route={state.route}
          title={routeTitle.title}
          web3State={state.web3State}
          dispatch={dispatch}
        />
        <div className="surface-canvas">
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
              <section className="deep-grid">
                <LifecycleTimeline steps={lifecycleSteps} />
                <StatusMatrix items={statusMatrix} />
              </section>
              <section className="deep-grid">
                <ActivityFeed events={liveData?.activityEvents ?? []} onNavigate={dispatch} />
                <ReceiptPanel receipts={receipts.slice(0, 2)} loading={isLoading} error={error} />
              </section>
            </>
          ) : null}
          {state.route === "create" ? <CreatePreview dispatch={dispatch} /> : null}
          {state.route === "streams" ? (
            <section className="streams-layout">
              <StreamTable
                streams={streams}
                selectedId={state.selectedStreamId}
                onSelect={(streamId) => dispatch({ type: "select-stream", streamId })}
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
              <ReceiptPanel receipts={receipts} loading={isLoading} error={error} />
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
    </main>
  );
}
