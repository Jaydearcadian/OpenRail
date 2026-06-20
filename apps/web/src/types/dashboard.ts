export type DashboardRoute = "overview" | "create" | "streams" | "gateway" | "receipts" | "proof" | "settings";

export type ScenarioState = "normal" | "loading" | "empty" | "error";

export type MockWeb3State =
  | "disconnected"
  | "wrong-network"
  | "pending-signature"
  | "pending-confirmation"
  | "confirmed"
  | "failed";

export type FlowKind = "railscard" | "railsflow";

export interface NavItem {
  route: DashboardRoute;
  label: string;
  icon: string;
  group: "control" | "infrastructure" | "utility";
}

export interface ActivityEvent {
  id: string;
  title: string;
  description: string;
  time: string;
  status: "info" | "warning" | "success";
  route: DashboardRoute;
}

export interface StatusMatrixItem {
  label: string;
  state: string;
  detail: string;
  status: "mock" | "ready" | "blocked";
}

export interface LifecycleStep {
  label: string;
  title: string;
  description: string;
  boundary: "user" | "sui" | "gateway" | "receipt";
}

export interface StreamDetail {
  id: string;
  label: string;
  counterparty: string;
  type: "RailsCard" | "RailsFlow";
  status: "active" | "pending" | "settled" | "warning";
  rate: string;
  accrued: string;
  remaining: string;
  metadata: string;
  receipt: string;
  terms: string;
  payer: string;
  recipient: string;
  projectionSource: string;
  safetyNote: string;
  receiptDigest?: string;
}

export interface CreatePreview {
  kind: FlowKind;
  title: string;
  subtitle: string;
  steps: string[];
  previewRows: Array<{ label: string; value: string }>;
}

export interface ProofCard {
  id: string;
  title: string;
  detail: string;
  status: "real-testnet" | "reference" | "not-connected";
  href?: string;
}

export interface DashboardState {
  route: DashboardRoute;
  sidebarCollapsed: boolean;
  selectedStreamId: string;
  activeModal: FlowKind | null;
  scenario: ScenarioState;
  web3State: MockWeb3State;
}

export type DashboardAction =
  | { type: "set-route"; route: DashboardRoute }
  | { type: "toggle-sidebar" }
  | { type: "select-stream"; streamId: string }
  | { type: "open-modal"; modal: FlowKind }
  | { type: "close-modal" }
  | { type: "set-scenario"; scenario: ScenarioState }
  | { type: "set-web3-state"; web3State: MockWeb3State };
