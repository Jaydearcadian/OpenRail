import type { Dispatch } from "react";
import type { DashboardAction, DashboardRoute, NavItem } from "../../types/dashboard";

interface DashboardSidebarProps {
  items: NavItem[];
  activeRoute: DashboardRoute;
  collapsed: boolean;
  mobileOpen: boolean;
  onBack: () => void;
  onNavigate: () => void;
  dispatch: Dispatch<DashboardAction>;
}

const groupLabels: Record<NavItem["group"], string> = {
  control: "Control",
  infrastructure: "Infrastructure",
  utility: "Utility",
};

const routeShortcuts: Partial<Record<DashboardRoute, string>> = {
  overview: "1",
  streams: "2",
  receipts: "3",
};

export function DashboardSidebar({ items, activeRoute, collapsed, mobileOpen, onBack, onNavigate, dispatch }: DashboardSidebarProps) {
  const grouped = items.reduce<Record<NavItem["group"], NavItem[]>>(
    (acc, item) => {
      acc[item.group].push(item);
      return acc;
    },
    { control: [], infrastructure: [], utility: [] },
  );

  const goTo = (route: DashboardRoute) => {
    dispatch({ type: "set-route", route });
    onNavigate();
  };

  return (
    <aside className={`dashboard-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-open" : ""}`} aria-label="Dashboard navigation">
      <div className="dashboard-sidebar-top">
        <button type="button" className="dashboard-brand" onClick={onBack} aria-label="Return to OpenRails landing">
          <span aria-hidden="true">◐</span>
          <strong>OpenRails</strong>
        </button>
        <button
          type="button"
          className="sidebar-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand dashboard navigation" : "Collapse dashboard navigation"}
          onClick={() => dispatch({ type: "toggle-sidebar" })}
        >
          <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
        </button>
      </div>

      <div className="sidebar-net">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="dot dot-live" style={{ background: "var(--sage)" }} aria-hidden="true" />
          sui:testnet
        </span>
        <span className="mut">pkg 0x7cb4…af55</span>
      </div>

      {Object.entries(grouped).map(([group, groupItems]) => (
        groupItems.length > 0 ? (
          <div className="nav-group" key={group}>
            <span className="nav-group-label">{groupLabels[group as NavItem["group"]]}</span>
            <nav className="dashboard-nav" aria-label={`${groupLabels[group as NavItem["group"]]} navigation`}>
              {groupItems.map((item) => (
                <button
                  key={item.route}
                  type="button"
                  className={item.route === activeRoute ? "active" : ""}
                  aria-current={item.route === activeRoute ? "page" : undefined}
                  aria-label={item.label}
                  title={item.label}
                  onClick={() => goTo(item.route)}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <strong>{item.label}</strong>
                  {routeShortcuts[item.route] ? <span className="kbd" aria-hidden="true">{routeShortcuts[item.route]}</span> : null}
                </button>
              ))}
            </nav>
          </div>
        ) : null
      ))}

      <div className="nav-group">
        <span className="nav-group-label nav-group-label--roadmap">Roadmap</span>
        <nav className="dashboard-nav" aria-label="Roadmap navigation">
          <button type="button" className="nav-item--locked" tabIndex={-1} aria-disabled="true" aria-label="Nonce Lanes — coming in V1.2">
            <span aria-hidden="true">⟨N⟩</span>
            <strong>Nonce Lanes</strong>
            <span className="v12-badge">V1.2</span>
          </button>
          <button type="button" className="nav-item--locked" tabIndex={-1} aria-disabled="true" aria-label="Write Access — coming in V1.2">
            <span aria-hidden="true">✍</span>
            <strong>Write Access</strong>
            <span className="v12-badge">V1.2</span>
          </button>
          <button type="button" className="nav-item--locked" tabIndex={-1} aria-disabled="true" aria-label="Access Credentials — coming in V1.2">
            <span aria-hidden="true">⚿</span>
            <strong>Access Credentials</strong>
            <span className="v12-badge">V1.2</span>
          </button>
        </nav>
      </div>

      <div className="sidebar-safety" title="Read-only Worker — no wallet writes">
        <strong><span>Read-only Worker</span></strong>
        <p>No wallet signature, Sui write, or Walrus upload will run. Receipt and stream reads use the public Worker.</p>
      </div>
    </aside>
  );
}
