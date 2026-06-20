import type { Dispatch } from "react";
import type { DashboardAction, DashboardRoute, MockWeb3State } from "../../types/dashboard";

interface DashboardTopbarProps {
  route: DashboardRoute;
  title: string;
  web3State: MockWeb3State;
  dispatch: Dispatch<DashboardAction>;
}

const web3Labels: Record<MockWeb3State, string> = {
  disconnected: "Wallet not connected",
  "wrong-network": "Wrong network preview",
  "pending-signature": "Signature preview",
  "pending-confirmation": "Confirmation preview",
  confirmed: "Confirmed preview",
  failed: "Failure preview",
};

const routeActions: Record<DashboardRoute, { label: string; target: DashboardRoute }> = {
  overview: { label: "Create rail preview", target: "create" },
  create: { label: "Inspect streams", target: "streams" },
  streams: { label: "View receipts", target: "receipts" },
  gateway: { label: "Verify proof", target: "proof" },
  receipts: { label: "Open proof center", target: "proof" },
  proof: { label: "Review settings", target: "settings" },
  settings: { label: "Return overview", target: "overview" },
};

export function DashboardTopbar({ route, title, web3State, dispatch }: DashboardTopbarProps) {
  const action = routeActions[route];

  return (
    <header className="dashboard-topbar">
      <div className="topbar-context">
        <span>Dashboard / {route}</span>
        <strong>{title}</strong>
      </div>
      <label className="topbar-search">
        <span className="sr-only">Search dashboard data, disabled in this preview</span>
        <input type="search" placeholder="Search disabled in preview" disabled />
      </label>
      <div className="topbar-actions" aria-label="Dashboard status">
        <span className="status-chip">Live Worker data</span>
        <span className="status-chip">Sui Testnet proof</span>
        <span className="status-chip">{web3Labels[web3State]}</span>
        <button type="button" onClick={() => dispatch({ type: "set-route", route: action.target })}>
          {action.label}
        </button>
      </div>
    </header>
  );
}
