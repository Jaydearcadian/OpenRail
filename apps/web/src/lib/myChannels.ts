import { SUI_NETWORK, OPENRAILS_PACKAGE_ID } from "../config";

/**
 * Local registry of Paycard ids the user has created or funded from this browser.
 * The console's curated Worker view only tracks showcase channels, so we remember
 * the user's own channels here and read them directly from chain.
 */

function key(): string {
  return `openrails:myChannels:${SUI_NETWORK}:${OPENRAILS_PACKAGE_ID}`;
}

export interface MyChannelEntry {
  id: string;
  role: "payer" | "recipient";
  kind: "RailsCard" | "RailsFlow" | "Paycard";
  createdAt: number;
}

export function listChannels(): MyChannelEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key());
    const arr = raw ? (JSON.parse(raw) as MyChannelEntry[]) : [];
    return arr.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function recordChannel(entry: Omit<MyChannelEntry, "createdAt">): void {
  if (typeof localStorage === "undefined") return;
  const existing = listChannels().filter((e) => e.id.toLowerCase() !== entry.id.toLowerCase());
  const next = [{ ...entry, createdAt: Date.now() }, ...existing].slice(0, 50);
  localStorage.setItem(key(), JSON.stringify(next));
}

export function forgetChannel(id: string): void {
  if (typeof localStorage === "undefined") return;
  const next = listChannels().filter((e) => e.id.toLowerCase() !== id.toLowerCase());
  localStorage.setItem(key(), JSON.stringify(next));
}
