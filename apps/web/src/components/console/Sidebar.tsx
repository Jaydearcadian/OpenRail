import { useContext } from "react";
import { SuiClientContext } from "@mysten/dapp-kit";
import { CONSOLE_NAV, type ConsoleRoute } from "./routes";
import { OPENRAILS_PACKAGE_ID, SUI_NETWORK } from "../../config";

interface SidebarProps {
  activeRoute: ConsoleRoute;
  mobileOpen: boolean;
  onNavigate: (route: ConsoleRoute) => void;
}

function shortPkg(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function Sidebar({ activeRoute, mobileOpen, onNavigate }: SidebarProps) {
  const clientCtx = useContext(SuiClientContext);
  const activeNetwork = clientCtx?.network ?? SUI_NETWORK;

  return (
    <aside className={`side ${mobileOpen ? "open" : ""}`} aria-label="Navigation">
      <div className="side-top">
        <div className="brand"><span className="glyph" aria-hidden="true" />openrails</div>
        <div className="net">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="dot live" style={{ background: "var(--green)" }} aria-hidden="true" />
            sui:{activeNetwork}
          </span>
          <span className="mut">pkg {shortPkg(OPENRAILS_PACKAGE_ID)}</span>
        </div>
      </div>

      <nav className="nav">
        {CONSOLE_NAV.map((group) => (
          <div key={group.group}>
            <div className="nlabel">{group.group}</div>
            {group.items.map((item) => (
              <button
                key={item.route}
                type="button"
                className={`nitem ${item.route === activeRoute ? "active" : ""}`}
                aria-current={item.route === activeRoute ? "page" : undefined}
                onClick={() => onNavigate(item.route)}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
                {item.kbd ? <span className="k">{item.kbd}</span> : null}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="side-bot">
        <span className="dot live" style={{ background: "var(--green)" }} aria-hidden="true" />
        gateway · receipts authoritative
      </div>
    </aside>
  );
}
