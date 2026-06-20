import {
  createOpenRailsApiClient,
  type IndexedSettlementReceiptV1,
  type OpenRailsProofV1_1,
  type OpenRailsStreamEvent as SdkOpenRailsStreamEvent,
  type OpenRailsStreamState as SdkOpenRailsStreamState,
} from "@openrails/sdk/api";
import { OPENRAILS_PACKAGE_ID } from "../config";

const DEFAULT_API_BASE_URL = "https://openrails-receipt-api.microcosm.workers.dev";

export { OPENRAILS_PACKAGE_ID };

export const OPENRAILS_PAYCARDS = [
  {
    id: "0x1809f38156fb5f2724708523ebcce13f04c8bda613c9e9b87ed8ace9b632e627",
    label: "RailsCard",
    type: "RailsCard" as const,
  },
  {
    id: "0x698ccb11cf64a75f6d09e21cb09275a0d5631fe72992c62f23875f0e0eca5f2a",
    label: "RailsFlow",
    type: "RailsFlow" as const,
  },
];

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

export const OPENRAILS_API_BASE_URL =
  env?.VITE_OPENRAILS_API_BASE_URL?.replace(/\/+$/, "") ?? DEFAULT_API_BASE_URL;

const openRailsClient = createOpenRailsApiClient(OPENRAILS_API_BASE_URL);

export type OpenRailsReceiptRecord = IndexedSettlementReceiptV1;

export interface OpenRailsStreamPayload {
  accruedSinceCheckpoint?: string;
  eventId: string;
  eventType: string;
  isExhausted?: boolean;
  paycardId: string;
  projectedBalance?: string;
  schemaVersion?: string;
  sequence: number;
  signature?: string;
  timestamp: number;
}

export type OpenRailsStreamEvent = Omit<SdkOpenRailsStreamEvent, "eventType" | "payload"> & {
  eventType: string;
  payload: OpenRailsStreamPayload;
};

export type OpenRailsStreamSummary = Omit<SdkOpenRailsStreamState, "latestEventType" | "payload"> & {
  latestEventType: string;
  payload: OpenRailsStreamPayload;
};

export interface OpenRailsStreamBundle {
  paycardId: string;
  label: string;
  type: "RailsCard" | "RailsFlow";
  summary: OpenRailsStreamSummary | null;
  events: OpenRailsStreamEvent[];
}

export type OpenRailsProofRecord = Omit<
  OpenRailsProofV1_1,
  "latestStreamState" | "terminalReceipt"
> & {
  latestStreamState: OpenRailsStreamSummary | null;
  terminalReceipt: OpenRailsReceiptRecord | null;
};

export interface OpenRailsWorkerData {
  apiBaseUrl: string;
  packageId: string;
  receipts: OpenRailsReceiptRecord[];
  streams: OpenRailsStreamBundle[];
  proofs: OpenRailsProofRecord[];
}

export async function fetchOpenRailsReceipts(signal?: AbortSignal): Promise<OpenRailsReceiptRecord[]> {
  return (await openRailsClient.listReceipts({ signal })).data as OpenRailsReceiptRecord[];
}

export async function fetchOpenRailsStream(
  paycardId: string,
  signal?: AbortSignal,
): Promise<OpenRailsStreamSummary | null> {
  return (await openRailsClient.getStream(paycardId, { signal })) as OpenRailsStreamSummary | null;
}

export async function fetchOpenRailsStreamEvents(
  paycardId: string,
  signal?: AbortSignal,
): Promise<OpenRailsStreamEvent[]> {
  return (await openRailsClient.listStreamEvents(paycardId, { signal })).data as OpenRailsStreamEvent[];
}

export async function fetchOpenRailsProof(
  paycardId: string,
  signal?: AbortSignal,
): Promise<OpenRailsProofRecord | null> {
  return (await openRailsClient.getProof(paycardId, { signal })) as OpenRailsProofRecord | null;
}

export async function fetchOpenRailsDashboard(signal?: AbortSignal): Promise<OpenRailsWorkerData> {
  const [receipts, streamAndProofs] = await Promise.all([
    fetchOpenRailsReceipts(signal),
    Promise.all(
      OPENRAILS_PAYCARDS.map(async (paycard) => {
        const [summary, events, proof] = await Promise.all([
          fetchOpenRailsStream(paycard.id, signal),
          fetchOpenRailsStreamEvents(paycard.id, signal),
          fetchOpenRailsProof(paycard.id, signal),
        ]);

        return {
          stream: {
            paycardId: paycard.id,
            label: paycard.label,
            type: paycard.type,
            summary: proof?.latestStreamState ?? summary,
            events,
          },
          proof,
        };
      }),
    ),
  ]);
  const streams = streamAndProofs.map((entry) => entry.stream);

  return {
    apiBaseUrl: OPENRAILS_API_BASE_URL,
    packageId: OPENRAILS_PACKAGE_ID,
    receipts,
    streams,
    proofs: streamAndProofs.map((entry) => entry.proof).filter((proof): proof is OpenRailsProofRecord => proof !== null),
  };
}
