import type { EventId, SuiClient, SuiEvent } from "@mysten/sui/client";
import {
  SETTLEMENT_TYPE_CANCELLED,
  SETTLEMENT_TYPE_DEPLETED,
  SETTLEMENT_TYPE_EXPIRED,
  type SettlementReceiptV1,
  type SettlementType,
} from "./types.js";

export interface IndexedSettlementReceiptV1 extends SettlementReceiptV1 {
  packageId: string;
  eventSeq: string;
  eventId: EventId;
  timestampMs?: string;
}

export interface QuerySettlementReceiptsParams {
  client: SuiClient;
  packageId: string;
  cursor?: EventId | null;
  limit?: number;
  descendingOrder?: boolean;
  paycardId?: string;
  payer?: string;
  recipient?: string;
  settlementType?: SettlementType;
}

export interface SettlementReceiptPage {
  data: IndexedSettlementReceiptV1[];
  nextCursor: EventId | null;
  hasNextPage: boolean;
}

function normalizeId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

function normalizeAmount(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  return null;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSettlementType(value: unknown): SettlementType | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : -1;

  if (
    parsed === SETTLEMENT_TYPE_DEPLETED ||
    parsed === SETTLEMENT_TYPE_EXPIRED ||
    parsed === SETTLEMENT_TYPE_CANCELLED
  ) {
    return parsed;
  }
  return null;
}

function isSettlementReceiptEvent(event: SuiEvent): boolean {
  return event.type.endsWith("::events::SettlementReceipt");
}

export function parseSettlementReceiptEvent(event: SuiEvent): IndexedSettlementReceiptV1 | null {
  if (!isSettlementReceiptEvent(event)) return null;

  const parsed = event.parsedJson as Record<string, unknown> | undefined;
  if (!parsed || typeof parsed !== "object") return null;

  const paycardId = normalizeId(parsed["paycard_id"]);
  const payer = normalizeId(parsed["payer"]);
  const recipient = normalizeId(parsed["recipient"]);
  const initialAllocation = normalizeAmount(parsed["initial_allocation"]);
  const maxFlowRatePerSecond = normalizeAmount(parsed["max_flow_rate_per_second"]);
  const startTimestamp = normalizeTimestamp(parsed["start_timestamp"]);
  const durationSeconds = normalizeTimestamp(parsed["duration_seconds"]);
  const residualDeltaRecipient = normalizeId(parsed["residual_delta_recipient"]);
  const residualDeltaAmount = normalizeAmount(parsed["residual_delta_amount"]);
  const totalPaidToRecipient = normalizeAmount(parsed["total_paid_to_recipient"]);
  const residualReturnedToPayer = normalizeAmount(parsed["residual_returned_to_payer"]);
  const settlementType = normalizeSettlementType(parsed["settlement_type"]);
  const closedAtSeconds = normalizeTimestamp(parsed["closed_at_seconds"]);

  if (
    !paycardId ||
    !payer ||
    !recipient ||
    totalPaidToRecipient === null ||
    residualReturnedToPayer === null ||
    settlementType === null ||
    closedAtSeconds === null
  ) {
    return null;
  }

  return {
    paycardId,
    payer,
    recipient,
    ...(initialAllocation === null ? {} : { initialAllocation }),
    ...(maxFlowRatePerSecond === null ? {} : { maxFlowRatePerSecond }),
    ...(startTimestamp === null ? {} : { startTimestamp }),
    ...(durationSeconds === null ? {} : { durationSeconds }),
    ...(residualDeltaRecipient === null ? {} : { residualDeltaRecipient }),
    ...(residualDeltaAmount === null ? {} : { residualDeltaAmount }),
    totalPaidToRecipient,
    residualReturnedToPayer,
    settlementType,
    closedAtSeconds,
    transactionDigest: event.id.txDigest,
    packageId: event.packageId,
    eventSeq: event.id.eventSeq,
    eventId: event.id,
    ...(event.timestampMs === null || event.timestampMs === undefined ? {} : { timestampMs: event.timestampMs }),
  };
}

function matchesFilters(
  receipt: IndexedSettlementReceiptV1,
  params: Pick<QuerySettlementReceiptsParams, "paycardId" | "payer" | "recipient" | "settlementType">
): boolean {
  return (
    (params.paycardId === undefined || receipt.paycardId === params.paycardId) &&
    (params.payer === undefined || receipt.payer === params.payer) &&
    (params.recipient === undefined || receipt.recipient === params.recipient) &&
    (params.settlementType === undefined || receipt.settlementType === params.settlementType)
  );
}

export async function querySettlementReceipts(
  params: QuerySettlementReceiptsParams
): Promise<SettlementReceiptPage> {
  const page = await params.client.queryEvents({
    query: {
      MoveEventType: `${params.packageId}::events::SettlementReceipt`,
    },
    cursor: params.cursor ?? undefined,
    limit: params.limit ?? 50,
    order: params.descendingOrder ? "descending" : "ascending",
  });

  return {
    data: page.data
      .map(parseSettlementReceiptEvent)
      .filter((receipt): receipt is IndexedSettlementReceiptV1 => receipt !== null)
      .filter((receipt) => matchesFilters(receipt, params)),
    nextCursor: page.nextCursor ?? null,
    hasNextPage: page.hasNextPage,
  };
}

export async function getSettlementReceiptByPaycardId(params: {
  client: SuiClient;
  packageId: string;
  paycardId: string;
  limit?: number;
  maxPages?: number;
}): Promise<IndexedSettlementReceiptV1 | null> {
  let cursor: EventId | null = null;
  const maxPages = params.maxPages ?? 20;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const page = await querySettlementReceipts({
      client: params.client,
      packageId: params.packageId,
      paycardId: params.paycardId,
      cursor,
      limit: params.limit ?? 50,
    });

    if (page.data.length > 0) return page.data[0];
    if (!page.hasNextPage || !page.nextCursor) return null;
    cursor = page.nextCursor;
  }

  return null;
}
