export type ConsoleRoute = "overview" | "write" | "rails" | "receipts" | "proof" | "nonces" | "credentials";

export interface ConsoleNavItem {
  route: ConsoleRoute;
  label: string;
  icon: string;
  kbd?: string;
}

export const CONSOLE_NAV: { group: string; items: ConsoleNavItem[] }[] = [
  {
    group: "monitor",
    items: [
      { route: "overview", label: "overview", icon: "⊞", kbd: "1" },
      { route: "rails", label: "rails", icon: "⇄", kbd: "2" },
      { route: "receipts", label: "receipts", icon: "▤", kbd: "3" },
    ],
  },
  {
    group: "build",
    items: [
      { route: "write", label: "open a rail", icon: "✎" },
      { route: "proof", label: "proof", icon: "◷" },
      { route: "nonces", label: "nonce lanes", icon: "⟨⟩" },
      { route: "credentials", label: "credentials", icon: "⚿" },
    ],
  },
];

export const CONSOLE_ROUTE_TITLE: Record<ConsoleRoute, string> = {
  overview: "overview",
  write: "open a rail",
  rails: "rails",
  receipts: "receipts",
  proof: "proof",
  nonces: "nonce lanes",
  credentials: "credentials",
};

export const SEARCHABLE: ConsoleRoute[] = ["overview", "rails", "receipts"];
