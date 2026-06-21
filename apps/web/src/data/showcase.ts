import type { Metric, Receipt, Stream } from "./mock";
import type {
  ActivityEvent,
  ProofCard,
  StatusMatrixItem,
  StreamDetail,
} from "../types/dashboard";
import type {
  OpenRailsProofRecord,
  OpenRailsReceiptRecord,
  OpenRailsStreamBundle,
  OpenRailsStreamEvent,
  OpenRailsWorkerData,
} from "../services/openrailsApi";

const SETTLEMENT_LABELS: Record<number, Receipt["type"]> = {
  0: "depleted",
  1: "expired",
  2: "cancelled",
};

export interface LiveDashboardData {
  metrics: Metric[];
  streams: Stream[];
  streamDetails: StreamDetail[];
  receipts: Receipt[];
  activityEvents: ActivityEvent[];
  proofCards: ProofCard[];
  proofs: OpenRailsProofRecord[];
  statusMatrix: StatusMatrixItem[];
  gatewayEvents: OpenRailsStreamEvent[];
  apiBaseUrl: string;
}

function shorten(value: string, head = 8, tail = 6) {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function formatMist(value?: string) {
  if (!value) return "not exposed";

  try {
    const mist = BigInt(value);
    const sign = mist < 0n ? "-" : "";
    const absolute = mist < 0n ? -mist : mist;
    const whole = absolute / 1_000_000_000n;
    const fraction = (absolute % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
    return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ""} SUI`;
  } catch {
    return value;
  }
}

function formatRate(events: OpenRailsStreamEvent[]) {
  const ordered = [...events]
    .filter((event) => event.payload.accruedSinceCheckpoint)
    .sort((a, b) => a.timestamp - b.timestamp);
  const first = ordered[0];
  const last = ordered.at(-1);

  if (!first || !last || first.timestamp === last.timestamp) {
    return "rate not exposed";
  }

  const firstAccrued = BigInt(first.payload.accruedSinceCheckpoint ?? "0");
  const lastAccrued = BigInt(last.payload.accruedSinceCheckpoint ?? "0");
  const seconds = BigInt(last.timestamp - first.timestamp);
  const delta = lastAccrued - firstAccrued;

  if (seconds <= 0n || delta < 0n) {
    return "rate not exposed";
  }

  return `≈${formatMist((delta / seconds).toString())}/s`;
}

function formatAsOf(timestamp?: number) {
  if (!timestamp) return "not reported";

  const date = new Date(timestamp * 1000);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function receiptType(receipt: OpenRailsReceiptRecord) {
  return SETTLEMENT_LABELS[receipt.settlementType] ?? "expired";
}

function receiptDigest(receipt: OpenRailsReceiptRecord) {
  return receipt.transactionDigest ?? receipt.eventId.txDigest;
}

function receiptTimestampMs(receipt: OpenRailsReceiptRecord) {
  return Number(receipt.timestampMs ?? 0);
}

function findReceipt(receipts: OpenRailsReceiptRecord[], paycardId: string) {
  return receipts.find((receipt) => receipt.paycardId.toLowerCase() === paycardId.toLowerCase());
}

function streamStatus(bundle: OpenRailsStreamBundle, receipt?: OpenRailsReceiptRecord): Stream["status"] {
  if (receipt) return "settled";
  if (bundle.summary?.payload.isExhausted) return "warning";
  if (bundle.summary) return "active";
  return "pending";
}

function streamReceiptLabel(receipt?: OpenRailsReceiptRecord) {
  return receipt ? receiptType(receipt) : "pending receipt";
}

function addMist(a?: string, b?: string) {
  try {
    return (BigInt(a ?? "0") + BigInt(b ?? "0")).toString();
  } catch {
    return "0";
  }
}

function mapReceipt(receipt: OpenRailsReceiptRecord): Receipt {
  const digest = receiptDigest(receipt);
  const initialMist = receipt.initialAllocation ?? addMist(receipt.totalPaidToRecipient, receipt.residualReturnedToPayer);

  return {
    id: `${digest}:${receipt.eventSeq}`,
    label: shorten(receipt.paycardId),
    type: receiptType(receipt),
    paid: formatMist(receipt.totalPaidToRecipient),
    residual: formatMist(receipt.residualReturnedToPayer),
    digest: shorten(digest),
    paycardId: shorten(receipt.paycardId),
    payer: shorten(receipt.payer),
    recipient: shorten(receipt.recipient),
    initial: formatMist(initialMist),
    paidMist: receipt.totalPaidToRecipient,
    residualMist: receipt.residualReturnedToPayer,
    initialMist,
    closedAt: formatAsOf(receipt.closedAtSeconds),
    txDigest: digest,
    explorerHref: `https://suiexplorer.com/txblock/${digest}?network=testnet`,
  };
}

function mapStream(bundle: OpenRailsStreamBundle, receipts: OpenRailsReceiptRecord[]): Stream {
  const receipt = findReceipt(receipts, bundle.paycardId);
  const payload = bundle.summary?.payload;

  return {
    id: bundle.paycardId,
    label: `${bundle.label} live paycard`,
    counterparty: receipt ? shorten(receipt.recipient) : "not exposed by stream endpoint",
    type: bundle.type,
    status: streamStatus(bundle, receipt),
    rate: formatRate(bundle.events),
    accrued: formatMist(payload?.accruedSinceCheckpoint),
    remaining: formatMist(payload?.projectedBalance),
    metadata: payload?.signature ? "signed heartbeat" : "no heartbeat signature",
    receipt: streamReceiptLabel(receipt),
    region: receipt ? "Receipt index" : "Gateway projection",
    asOf: formatAsOf(bundle.summary?.latestTimestamp),
  };
}

function mapStreamDetail(stream: Stream, bundle: OpenRailsStreamBundle, receipts: OpenRailsReceiptRecord[]): StreamDetail {
  const receipt = findReceipt(receipts, bundle.paycardId);
  const latestEvent = bundle.summary?.payload;

  return {
    ...stream,
    terms: "Live stream terms are not exposed by the Worker stream projection.",
    payer: receipt ? shorten(receipt.payer) : "not exposed by stream endpoint",
    recipient: receipt ? shorten(receipt.recipient) : stream.counterparty,
    projectionSource: latestEvent
      ? `Signed Worker projection, sequence ${latestEvent.sequence}`
      : "No stream projection returned by Worker",
    safetyNote: "Gateway values are signed projections for UX. SettlementReceipt records remain the authoritative accounting source.",
    receiptDigest: receipt ? shorten(receiptDigest(receipt)) : undefined,
    ratePerSecMist: receipt?.maxFlowRatePerSecond,
    startTimestampSec: receipt?.startTimestamp,
    endTimestampSec: receipt?.closedAtSeconds,
  };
}

function mapActivity(data: OpenRailsWorkerData): ActivityEvent[] {
  const receiptEvents = data.receipts.slice(0, 2).map((receipt, index) => ({
    id: `receipt-${receiptDigest(receipt)}:${receipt.eventSeq}`,
    title: "Settlement receipt indexed",
    description: `${receiptType(receipt)} receipt for ${shorten(receipt.paycardId)}.`,
    time: formatAsOf(Math.floor(receiptTimestampMs(receipt) / 1000)),
    status: "success" as const,
    route: "receipts" as const,
    sortKey: receiptTimestampMs(receipt) + index,
  }));

  const streamEvents = data.streams
    .filter((stream) => stream.summary)
    .map((stream) => ({
      id: stream.summary?.latestEventId ?? stream.paycardId,
      title: "Gateway projection sampled",
      description: `${stream.label} sequence ${stream.summary?.latestSequence ?? "n/a"} from the Worker.`,
      time: formatAsOf(stream.summary?.latestTimestamp),
      status: "info" as const,
      route: "gateway" as const,
      sortKey: stream.summary?.latestTimestamp ?? 0,
    }));

  return [...receiptEvents, ...streamEvents]
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, 4)
    .map(({ sortKey: _sortKey, ...event }) => event);
}

function buildMetrics(data: OpenRailsWorkerData, streams: Stream[]): Metric[] {
  const latestSequence = data.streams.reduce(
    (highest, stream) => Math.max(highest, stream.summary?.latestSequence ?? 0),
    0,
  );
  const latestReceipt = data.receipts[0];

  return [
    {
      label: "Settled by receipt",
      value: data.receipts.length.toString(),
      helper: "terminal events returned by the Worker receipt index",
      trend: latestReceipt ? shorten(receiptDigest(latestReceipt)) : "no receipts",
      tone: "blue",
      dominant: true,
    },
    {
      label: "Live streams",
      value: streams.length.toString(),
      helper: "fresh RailsCard and RailsFlow paycards queried from the Worker",
      trend: `${streams.filter((stream) => stream.status === "active").length} active`,
      tone: "green",
    },
    {
      label: "Gateway sequence",
      value: latestSequence.toString(),
      helper: "highest signed projection sequence across live streams",
      trend: "projection only",
      tone: "violet",
    },
    {
      label: "Worker source",
      value: "Live",
      helper: data.apiBaseUrl,
      trend: "override via VITE",
      tone: "amber",
    },
  ];
}

function buildProofCards(data: OpenRailsWorkerData, streams: Stream[]): ProofCard[] {
  const proof = data.proofs[0];
  const streamWithEvent = data.streams.find((stream) => stream.summary);
  const receipt = data.receipts[0];

  return [
    {
      id: "proof-package",
      title: "OpenRails package",
      detail: shorten(data.packageId, 10, 8),
      status: "real-testnet",
      href: `https://suiexplorer.com/object/${data.packageId}?network=testnet`,
    },
    {
      id: "proof-api",
      title: "Public proof API",
      detail: `${data.proofs.length} proof records joined from ${data.apiBaseUrl}`,
      status: "real-testnet",
      href: proof ? `${data.apiBaseUrl}/v1/proofs/${proof.paycardId}` : `${data.apiBaseUrl}/v1/receipts`,
    },
    {
      id: "proof-gateway",
      title: "Gateway projection",
      detail: streamWithEvent
        ? `${streamWithEvent.label} sequence ${streamWithEvent.summary?.latestSequence ?? "n/a"}`
        : "No stream projection returned by Worker",
      status: streamWithEvent ? "real-testnet" : "not-connected",
      href: streamWithEvent ? `${data.apiBaseUrl}/v1/streams/${streamWithEvent.paycardId}` : undefined,
    },
    {
      id: "proof-receipt",
      title: "Latest terminal receipt",
      detail: receipt ? `${receiptType(receipt)} · ${shorten(receiptDigest(receipt))}` : "No terminal receipt returned by Worker",
      status: receipt ? "real-testnet" : "not-connected",
      href: receipt ? `https://suiexplorer.com/txblock/${receiptDigest(receipt)}?network=testnet` : undefined,
    },
    {
      id: "proof-paycards",
      title: "Fresh active paycards",
      detail: streams.map((stream) => `${stream.type}: ${shorten(stream.id)}`).join(" · "),
      status: streams.length ? "real-testnet" : "not-connected",
    },
  ];
}

function buildStatusMatrix(data: OpenRailsWorkerData, streams: Stream[]): StatusMatrixItem[] {
  return [
    { label: "Dashboard mode", state: "Live Worker", detail: "Stream and receipt surfaces query the deployed Worker.", status: "ready" },
    { label: "Gateway projections", state: "Signed", detail: `${streams.length} paycards loaded from /v1/streams.`, status: "ready" },
    { label: "Receipt index", state: "Authoritative", detail: `${data.receipts.length} terminal records loaded from /v1/receipts.`, status: "ready" },
    { label: "Wallet signing", state: "Not connected", detail: "No signatures or Sui writes are submitted by this UI.", status: "blocked" },
    { label: "Package", state: "Testnet", detail: shorten(data.packageId, 10, 8), status: "ready" },
    { label: "Walrus metadata", state: "Reference", detail: "The Worker stream endpoints do not expose Walrus metadata.", status: "mock" },
  ];
}

export function buildLiveDashboardData(data: OpenRailsWorkerData): LiveDashboardData {
  const streams = data.streams.map((stream) => mapStream(stream, data.receipts));

  return {
    metrics: buildMetrics(data, streams),
    streams,
    streamDetails: streams.map((stream, index) => mapStreamDetail(stream, data.streams[index], data.receipts)),
    receipts: data.receipts.map(mapReceipt),
    activityEvents: mapActivity(data),
    proofCards: buildProofCards(data, streams),
    proofs: data.proofs,
    statusMatrix: buildStatusMatrix(data, streams),
    gatewayEvents: data.streams.flatMap((stream) => stream.events),
    apiBaseUrl: data.apiBaseUrl,
  };
}
