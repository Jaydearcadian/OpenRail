import type { Dispatch } from "react";
import type { DashboardAction, DashboardRoute, NavItem } from "../../types/dashboard";

interface DashboardSidebarProps {
  items: NavItem[];
  activeRoute: DashboardRoute;
  collapsed: boolean;
  onBack: () => void;
  dispatch: Dispatch<DashboardAction>;
}

const groupLabels: Record<NavItem["group"], string> = {
  control: "Control",
  infrastructure: "Infrastructure",
  utility: "Utility",
};

export function DashboardSidebar({ items, activeRoute, collapsed, onBack, dispatch }: DashboardSidebarProps) {
  const grouped = items.reduce<Record<NavItem["group"], NavItem[]>>(
    (acc, item) => {
      acc[item.group].push(item);
      return acc;
    },
    { control: [], infrastructure: [], utility: [] },
  );

  return (
    <aside className={`dashboard-sidebar ${collapsed ? "is-collapsed" : ""}`} aria-label="Dashboard navigation">
      <div className="dashboard-sidebar-top">
        <button type="button" className="dashboard-brand" onClick={onBack} aria-label="Return to OpenRails landing">
          <span>OR</span>
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
                  onClick={() => dispatch({ type: "set-route", route: item.route })}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <strong>{item.label}</strong>
                </button>
              ))}
            </nav>
          </div>
        ) : null
      ))}

      <div className="sidebar-safety">
        <strong>Read-only Worker</strong>
        <p>No wallet signature, Sui write, or Walrus upload will run. Receipt and stream reads use the public Worker.</p>
      </div>
    </aside>
  );
}
