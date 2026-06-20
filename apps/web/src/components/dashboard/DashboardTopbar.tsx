import type { Dispatch } from "react";
import type { DashboardAction, DashboardRoute, MockWeb3State } from "../../types/dashboard";

interface DashboardTopbarProps {
  route: DashboardRoute;
  title: string;
  web3State: MockWeb3State;
  search: string;
  onSearch: (value: string) => void;
  onMenu: () => void;
  dispatch: Dispatch<DashboardAction>;
}

const web3Labels: Record<MockWeb3State, string> = {
  disconnected: "wallet: disconnected",
  "wrong-network": "wallet: wrong network",
  "pending-signature": "wallet: signing",
  "pending-confirmation": "wallet: confirming",
  confirmed: "wallet: confirmed",
  failed: "wallet: failed",
};

const routeActions: Record<DashboardRoute, { label: string; target: DashboardRoute }> = {
  overview: { label: "+ rail", target: "create" },
  create: { label: "Inspect streams", target: "streams" },
  streams: { label: "View receipts", target: "receipts" },
  gateway: { label: "Verify proof", target: "proof" },
  receipts: { label: "Open proof center", target: "proof" },
  proof: { label: "Review settings", target: "settings" },
  settings: { label: "Return overview", target: "overview" },
};

const searchableRoutes: DashboardRoute[] = ["streams", "receipts", "overview"];

export function DashboardTopbar({ route, title, web3State, search, onSearch, onMenu, dispatch }: DashboardTopbarProps) {
  const action = routeActions[route];
  const canSearch = searchableRoutes.includes(route);

  return (
    <header className="dashboard-topbar">
      <button type="button" className="menu-btn" aria-label="Open navigation" onClick={onMenu}>☰</button>
      <div className="topbar-context">
        <span>openrails / {route}</span>
        <strong>{title}</strong>
      </div>

      <label className="topbar-search">
        <span className="sr-only">Filter rails and receipts</span>
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          id="dashboard-search"
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={canSearch ? "Filter rails, receipts…" : "Search (streams · receipts)"}
        />
        <span className="kbd" aria-hidden="true">⌘K</span>
      </label>

      <div className="topbar-actions" aria-label="Dashboard status">
        <span className="status-chip">{web3Labels[web3State]}</span>
        <button type="button" className="btn-ink" onClick={() => dispatch({ type: "set-route", route: action.target })}>
          {action.label}
        </button>
      </div>
    </header>
  );
}
