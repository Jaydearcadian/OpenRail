import type { SuiClient } from "@mysten/sui/client";

/** Live on-chain state of a Paycard channel — the "is this channel usable" check. */
export interface ChannelState {
  exists: boolean;
  status: "active" | "depleted" | "cancelled" | "unknown";
  /** active === status active && pool > 0 && now < end. */
  active: boolean;
  poolBalance?: bigint;
  payer?: string;
  recipient?: string;
  startTimestamp?: number;
  durationSeconds?: number;
  endTimeSec?: number;
}

/** Move `Balance<T>` can surface as a numeric string or a nested `{ value }`. */
function parseBalance(value: unknown): bigint | undefined {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  if (value && typeof value === "object" && "value" in value) {
    return parseBalance((value as { value: unknown }).value);
  }
  return undefined;
}

/**
 * Reads a Paycard object and reports whether the channel is currently live.
 * Reused by access-credential verification and any merchant backend.
 */
export async function getChannelState(params: {
  client: Pick<SuiClient, "getObject">;
  paycardId: string;
  nowSec?: number;
}): Promise<ChannelState> {
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000);
  const res = await params.client.getObject({ id: params.paycardId, options: { showContent: true } });

  const content = res.data?.content;
  if (!content || content.dataType !== "moveObject") {
    return { exists: false, status: "unknown", active: false };
  }

  const fields = ((content as { fields?: Record<string, unknown> }).fields ?? {}) as Record<string, unknown>;
  const statusNum = Number(fields.status ?? -1);
  const status: ChannelState["status"] =
    statusNum === 0 ? "active" : statusNum === 2 ? "depleted" : statusNum === 3 ? "cancelled" : "unknown";

  const poolBalance = parseBalance(fields.allocation_pool);
  const startTimestamp = fields.start_timestamp != null ? Number(fields.start_timestamp) : undefined;
  const durationSeconds = fields.duration_seconds != null ? Number(fields.duration_seconds) : undefined;
  const endTimeSec =
    startTimestamp != null && durationSeconds != null ? startTimestamp + durationSeconds : undefined;

  const notExpired = endTimeSec == null ? true : nowSec < endTimeSec;
  const active = status === "active" && (poolBalance == null || poolBalance > 0n) && notExpired;

  return {
    exists: true,
    status,
    active,
    poolBalance,
    payer: typeof fields.payer === "string" ? fields.payer : undefined,
    recipient: typeof fields.recipient === "string" ? fields.recipient : undefined,
    startTimestamp,
    durationSeconds,
    endTimeSec,
  };
}
