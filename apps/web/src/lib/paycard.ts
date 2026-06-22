import type { SuiClient } from "@mysten/sui/client";

/** On-chain Paycard status codes (paycard_v1.move). */
export const PAYCARD_STATUS: Record<number, string> = { 0: "active", 2: "depleted", 3: "cancelled" };

export interface PaycardView {
  id: string;
  payer: string;
  recipient: string;
  initialAllocation: string;
  poolValue: string;
  ratePerSec: string;
  startSec: number;
  durationSec: number;
  recovery: string;
  status: number;
}

/** Parse a Paycard object's content fields into a typed view. */
export function readPaycard(id: string, content: unknown): PaycardView | null {
  const fields = (content as { fields?: Record<string, unknown> })?.fields;
  if (!fields) return null;
  const pool = fields.allocation_pool as { fields?: { value?: string } } | string | undefined;
  const poolValue = typeof pool === "object" ? pool?.fields?.value ?? "0" : String(pool ?? "0");
  return {
    id,
    payer: String(fields.payer ?? ""),
    recipient: String(fields.recipient ?? ""),
    initialAllocation: String(fields.initial_allocation ?? "0"),
    poolValue,
    ratePerSec: String(fields.max_flow_rate_per_second ?? "0"),
    startSec: Number(fields.start_timestamp ?? 0),
    durationSec: Number(fields.duration_seconds ?? 0),
    recovery: String(fields.residual_delta_recipient ?? ""),
    status: Number(fields.status ?? 0),
  };
}

/** Fetch a single Paycard from chain, or null if it doesn't exist on this network. */
export async function fetchPaycard(client: SuiClient, id: string): Promise<PaycardView | null> {
  const res = await client.getObject({ id, options: { showContent: true } });
  return readPaycard(id, res.data?.content);
}

/** Settlement outcome read from a SettlementReceipt event. */
export const SETTLEMENT_TYPE: Record<number, string> = { 0: "depleted", 1: "expired", 2: "cancelled" };

export interface ReceiptView {
  paidMist: string;
  residualMist: string;
  initialMist: string;
  settlementType: number;
}

function sameId(a: string, b: string): boolean {
  try { return BigInt(a) === BigInt(b); } catch { return a.toLowerCase() === b.toLowerCase(); }
}

/**
 * Auto-discover the address's channels straight from PaycardMinted events —
 * both as payer and as recipient — so they appear without manual import or
 * localStorage. Card-vs-flow can't be known from chain.
 *
 * Two queries (the fullnode rejects the {All:[...]} combinator):
 *  - Sender == address → channels you opened (payer).
 *  - global PaycardMinted, filtered client-side by recipient == address →
 *    channels funded *to* you (merchant/recipient side).
 */
export async function fetchMintedChannels(
  client: SuiClient,
  packageId: string,
  address: string,
): Promise<Array<{ id: string; role: "payer" | "recipient" }>> {
  const mintType = `${packageId}::events::PaycardMinted`;
  const [bySender, byType] = await Promise.all([
    client.queryEvents({ query: { Sender: address }, limit: 50, order: "descending" }),
    client.queryEvents({ query: { MoveEventType: mintType }, limit: 50, order: "descending" }),
  ]);
  const out = new Map<string, { id: string; role: "payer" | "recipient" }>();
  for (const ev of bySender.data) {
    if (ev.type !== mintType) continue;
    const p = ev.parsedJson as Record<string, unknown> | undefined;
    if (p && typeof p.paycard_id === "string") out.set(p.paycard_id.toLowerCase(), { id: p.paycard_id, role: "payer" });
  }
  for (const ev of byType.data) {
    const p = ev.parsedJson as Record<string, unknown> | undefined;
    if (!p || typeof p.paycard_id !== "string") continue;
    const key = p.paycard_id.toLowerCase();
    if (out.has(key)) continue;
    if (typeof p.payer === "string" && sameId(p.payer, address)) out.set(key, { id: p.paycard_id, role: "payer" });
    else if (typeof p.recipient === "string" && sameId(p.recipient, address)) out.set(key, { id: p.paycard_id, role: "recipient" });
  }
  return [...out.values()];
}

/** Resolve a created Paycard id from a transaction digest (for import-by-tx). */
export async function paycardIdFromTx(client: SuiClient, digest: string): Promise<string | null> {
  const res = await client.getTransactionBlock({ digest, options: { showObjectChanges: true } });
  const changes = (res.objectChanges ?? []) as Array<{ type?: string; objectType?: string; objectId?: string }>;
  return changes.find((c) => c.type === "created" && typeof c.objectType === "string" && c.objectType.includes("::paycard_v1::Paycard"))?.objectId ?? null;
}

/**
 * Read a paycard's SettlementReceipt directly from chain (no Worker dependency).
 * Scans recent SettlementReceipt events for the package and matches by paycard id.
 */
export async function fetchReceiptForPaycard(
  client: SuiClient,
  packageId: string,
  paycardId: string,
): Promise<ReceiptView | null> {
  const res = await client.queryEvents({
    query: { MoveEventType: `${packageId}::events::SettlementReceipt` },
    limit: 50,
    order: "descending",
  });
  for (const ev of res.data) {
    const p = ev.parsedJson as Record<string, unknown> | undefined;
    if (p && typeof p.paycard_id === "string" && sameId(p.paycard_id, paycardId)) {
      return {
        paidMist: String(p.total_paid_to_recipient ?? "0"),
        residualMist: String(p.residual_returned_to_payer ?? "0"),
        initialMist: String(p.initial_allocation ?? "0"),
        settlementType: Number(p.settlement_type ?? 0),
      };
    }
  }
  return null;
}
