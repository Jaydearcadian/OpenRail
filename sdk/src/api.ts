import type { EventId } from "@mysten/sui/client";
import type { SignedGatewayEvent } from "./heartbeat.js";
import type { OpenRailsProofV1_1 } from "./proof.js";
import type { IndexedSettlementReceiptV1 } from "./receipts.js";
import type { SettlementType } from "./types.js";

export type { OpenRailsProofV1_1 } from "./proof.js";
export type { IndexedSettlementReceiptV1 } from "./receipts.js";

export interface OpenRailsApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface OpenRailsHealthResponse {
  ok: true;
}

export interface OpenRailsDataEnvelope<T> {
  data: T;
}

export interface OpenRailsPageEnvelope<T, Cursor = EventId | null> extends OpenRailsDataEnvelope<T[]> {
  nextCursor: Cursor | null;
  hasNextPage: boolean;
}

export interface OpenRailsApiClientOptions {
  fetch?: OpenRailsFetch;
  headers?: Record<string, string>;
}

export interface OpenRailsRequestOptions {
  signal?: AbortSignal;
}

export interface ListOpenRailsReceiptsParams extends OpenRailsRequestOptions {
  limit?: number;
  order?: "ascending" | "descending";
  cursorTxDigest?: string;
  cursorEventSeq?: string;
  paycardId?: string;
  payer?: string;
  recipient?: string;
  settlementType?: SettlementType;
}

export interface GetOpenRailsReceiptParams extends OpenRailsRequestOptions {
  limit?: number;
  maxPages?: number;
}

export interface ListOpenRailsStreamEventsParams extends OpenRailsRequestOptions {
  limit?: number;
  cursor?: string;
}

export interface GetOpenRailsProofParams extends OpenRailsRequestOptions {
  limit?: number;
  receiptLimit?: number;
  maxPages?: number;
}

export interface OpenRailsStreamState {
  paycardId: string;
  latestEventId: string;
  latestEventType: SignedGatewayEvent["eventType"];
  latestSequence: number;
  latestTimestamp: number;
  payload: SignedGatewayEvent;
  updatedAtMs: number;
}

export interface OpenRailsStreamEvent {
  eventId: string;
  paycardId: string;
  eventType: SignedGatewayEvent["eventType"];
  sequence: number;
  timestamp: number;
  payload: SignedGatewayEvent;
  payloadJson?: string;
  createdAtMs: number;
}

export interface OpenRailsApiClient {
  health(options?: OpenRailsRequestOptions): Promise<OpenRailsHealthResponse>;
  listReceipts(params?: ListOpenRailsReceiptsParams): Promise<OpenRailsPageEnvelope<IndexedSettlementReceiptV1>>;
  getReceipt(paycardId: string, params?: GetOpenRailsReceiptParams): Promise<IndexedSettlementReceiptV1 | null>;
  getStream(paycardId: string, options?: OpenRailsRequestOptions): Promise<OpenRailsStreamState | null>;
  listStreamEvents(
    paycardId: string,
    params?: ListOpenRailsStreamEventsParams
  ): Promise<OpenRailsPageEnvelope<OpenRailsStreamEvent, string>>;
  getProof(paycardId: string, params?: GetOpenRailsProofParams): Promise<OpenRailsProofV1_1 | null>;
}

interface OpenRailsFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type OpenRailsFetch = (
  input: string,
  init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }
) => Promise<OpenRailsFetchResponse>;

export class OpenRailsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "OpenRailsApiError";
    this.status = status;
    this.code = code;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("OpenRails API base URL is required.");
  }
  return normalized;
}

function appendQuery(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

async function parseApiError(response: OpenRailsFetchResponse): Promise<OpenRailsApiError> {
  try {
    const body = (await response.json()) as Partial<OpenRailsApiErrorBody>;
    const code = body.error?.code ?? "request_failed";
    const message = body.error?.message ?? `OpenRails API request failed with status ${response.status}.`;
    return new OpenRailsApiError(response.status, code, message);
  } catch {
    const text = await response.text().catch(() => "");
    return new OpenRailsApiError(
      response.status,
      "request_failed",
      text || `OpenRails API request failed with status ${response.status}.`
    );
  }
}

export function createOpenRailsApiClient(baseUrl: string, clientOptions: OpenRailsApiClientOptions = {}): OpenRailsApiClient {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const fetchImpl = clientOptions.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("A fetch implementation is required.");
  }

  async function request<T>(
    path: string,
    nullableStatuses: number[] = [],
    requestOptions: OpenRailsRequestOptions = {}
  ): Promise<T | null> {
    const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
      headers: {
        accept: "application/json",
        ...clientOptions.headers,
      },
      signal: requestOptions.signal,
    });

    if (nullableStatuses.includes(response.status)) return null;
    if (!response.ok) throw await parseApiError(response);
    return (await response.json()) as T;
  }

  return {
    async health(options: OpenRailsRequestOptions = {}): Promise<OpenRailsHealthResponse> {
      return (await request<OpenRailsHealthResponse>("/health", [], options)) as OpenRailsHealthResponse;
    },

    async listReceipts(params: ListOpenRailsReceiptsParams = {}): Promise<OpenRailsPageEnvelope<IndexedSettlementReceiptV1>> {
      return (await request<OpenRailsPageEnvelope<IndexedSettlementReceiptV1>>(
        appendQuery("/v1/receipts", {
          limit: params.limit,
          order: params.order,
          cursorTxDigest: params.cursorTxDigest,
          cursorEventSeq: params.cursorEventSeq,
          paycardId: params.paycardId,
          payer: params.payer,
          recipient: params.recipient,
          settlementType: params.settlementType,
        }),
        [],
        params
      )) as OpenRailsPageEnvelope<IndexedSettlementReceiptV1>;
    },

    async getReceipt(paycardId: string, params: GetOpenRailsReceiptParams = {}): Promise<IndexedSettlementReceiptV1 | null> {
      const payload = await request<OpenRailsDataEnvelope<IndexedSettlementReceiptV1>>(
        appendQuery(`/v1/receipts/${encodeURIComponent(paycardId)}`, {
          limit: params.limit,
          maxPages: params.maxPages,
        }),
        [404],
        params
      );
      return payload?.data ?? null;
    },

    async getStream(paycardId: string, options: OpenRailsRequestOptions = {}): Promise<OpenRailsStreamState | null> {
      const payload = await request<OpenRailsDataEnvelope<OpenRailsStreamState>>(
        `/v1/streams/${encodeURIComponent(paycardId)}`,
        [404],
        options
      );
      return payload?.data ?? null;
    },

    async listStreamEvents(
      paycardId: string,
      params: ListOpenRailsStreamEventsParams = {}
    ): Promise<OpenRailsPageEnvelope<OpenRailsStreamEvent, string>> {
      return (await request<OpenRailsPageEnvelope<OpenRailsStreamEvent, string>>(
        appendQuery(`/v1/streams/${encodeURIComponent(paycardId)}/events`, {
          limit: params.limit,
          cursor: params.cursor,
        }),
        [],
        params
      )) as OpenRailsPageEnvelope<OpenRailsStreamEvent, string>;
    },

    async getProof(paycardId: string, params: GetOpenRailsProofParams = {}): Promise<OpenRailsProofV1_1 | null> {
      const payload = await request<OpenRailsDataEnvelope<OpenRailsProofV1_1>>(
        appendQuery(`/v1/proofs/${encodeURIComponent(paycardId)}`, {
          limit: params.limit,
          receiptLimit: params.receiptLimit,
          maxPages: params.maxPages,
        }),
        [404],
        params
      );
      return payload?.data ?? null;
    },
  };
}
