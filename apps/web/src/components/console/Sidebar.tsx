import { useContext } from "react";
import { SuiClientContext } from "@mysten/dapp-kit";
import { CONSOLE_NAV, type ConsoleRoute } from "./routes";
import { OPENRAILS_PACKAGE_ID, SUI_NETWORK, GITHUB_REPO_URL, GITHUB_DOCS_URL, explorerObjectUrl } from "../../config";

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
        <a className="brand" href="/" title="Back to home"><span className="glyph" aria-hidden="true" />openrails</a>
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

      <div className="side-links">
        <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">github</a>
        <a href={GITHUB_DOCS_URL} target="_blank" rel="noreferrer">docs</a>
        <a href={explorerObjectUrl(OPENRAILS_PACKAGE_ID)} target="_blank" rel="noreferrer">package</a>
      </div>
      <div className="side-bot">
        <span className="dot live" style={{ background: "var(--green)" }} aria-hidden="true" />
        gateway · receipts authoritative
      </div>
    </aside>
  );
}
