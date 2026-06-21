/**
 * RailsCard / RailsFlow shareable links.
 *
 * RailsCard (outbound grant): the payer funds a Paycard on-chain *now*, then
 * shares a link to that object id. Opening it lets the recipient view & claim.
 *   link → <origin>/r/<paycardId>
 *
 * RailsFlow (inbound invoice): the recipient/merchant signs *terms* with no
 * on-chain object yet, and shares a link encoding those terms. Opening it lets
 * the payer fund the channel (which mints the Paycard).
 *   link → <origin>/i#<base64url(terms)>
 */

export interface FlowTerms {
  v: 1;
  kind: "flow";
  recipient: string;
  allocMist: string;
  rateMist: string;
  durationSec: number;
  recovery: string;
  memo?: string;
}

export type RailTarget =
  | { kind: "card"; paycardId: string }
  | { kind: "flow"; terms: FlowTerms };

function origin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

function b64urlEncode(json: string): string {
  const b64 = typeof btoa !== "undefined" ? btoa(json) : Buffer.from(json).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString();
}

export function railCardUrl(paycardId: string): string {
  return `${origin()}/r/${paycardId}`;
}

export function railFlowUrl(terms: FlowTerms): string {
  return `${origin()}/i#${b64urlEncode(JSON.stringify(terms))}`;
}

/** Read the current browser location and decode a rail target, if any. */
export function parseLocation(): RailTarget | null {
  if (typeof window === "undefined") return null;
  const { pathname, hash } = window.location;

  const cardMatch = pathname.match(/^\/r\/(0x[0-9a-fA-F]+)\/?$/);
  if (cardMatch) return { kind: "card", paycardId: cardMatch[1] };

  if (pathname.replace(/\/$/, "") === "/i" && hash.length > 1) {
    try {
      const terms = JSON.parse(b64urlDecode(hash.slice(1))) as FlowTerms;
      if (terms?.kind === "flow" && terms.recipient && terms.allocMist) return { kind: "flow", terms };
    } catch {
      return null;
    }
  }
  return null;
}

/** Return to the main console (clears the deep-link path). */
export function clearRailLocation() {
  if (typeof window !== "undefined") window.history.pushState({}, "", "/");
}
