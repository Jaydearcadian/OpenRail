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
