import { ConnectMenu } from "../../wallet/ConnectMenu";
import { SEARCHABLE, type ConsoleRoute } from "./routes";

interface AppbarProps {
  route: ConsoleRoute;
  search: string;
  onSearch: (value: string) => void;
  onMenu: () => void;
  onOpenRail: () => void;
}

export function Appbar({ route, search, onSearch, onMenu, onOpenRail }: AppbarProps) {
  const canSearch = SEARCHABLE.includes(route);
  return (
    <header className="appbar">
      <div className="appbar-left">
        <button type="button" className="btn btn-ghost menu-btn" aria-label="Open navigation" onClick={onMenu}>☰</button>
        <span className="crumb">openrails / <b>{route}</b></span>
      </div>
      <div className="appbar-right">
        <label className="search">
          <span className="sr-only">Filter rails and receipts</span>
          <span aria-hidden="true">⌕</span>
          <input
            id="console-search"
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={canSearch ? "filter rails, receipts…" : "search (rails · receipts)"}
          />
          <span className="kbd" aria-hidden="true">⌘K</span>
        </label>
        <button type="button" className="btn btn-primary" onClick={onOpenRail}>+ rail</button>
        <ConnectMenu />
      </div>
    </header>
  );
}
