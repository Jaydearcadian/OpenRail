import {
  SETTLEMENT_TYPE_CANCELLED,
  SETTLEMENT_TYPE_DEPLETED,
  SETTLEMENT_TYPE_EXPIRED,
  type SettlementType,
} from "@openrails/sdk/worker";
import {
  type SignedGatewayEvent,
  verifyGatewayEvent,
} from "@openrails/sdk/worker";
import {
  getSettlementReceiptByPaycardId,
  querySettlementReceipts,
} from "@openrails/sdk/worker";
import {
  buildOpenRailsProof,
  gatewayEventMetadata,
  type OpenRailsProofStreamState,
} from "@openrails/sdk/worker";
import { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { runReceiptIndexer } from "./indexer.js";
import {
  createD1ReceiptStorage,
  stableJson,
  type PaycardState,
  type ReceiptStorage,
  type StoredGatewayEvent,
} from "./storage.js";

const RPC_URLS = {
  testnet: "https://fullnode.testnet.sui.io:443",
  mainnet: "https://fullnode.mainnet.sui.io:443",
} as const;

type Network = keyof typeof RPC_URLS;
type EventId = { txDigest: string; eventSeq: string };

export interface ReceiptApiEnv {
  SUI_NETWORK?: string;
  SUI_RPC_URL?: string;
  OPENRAILS_PACKAGE_ID?: string;
  GATEWAY_PUBLIC_KEY_HEX?: string;
  ADMIN_TOKEN?: string;
  RECEIPT_DB?: D1Database;
  RECEIPT_STORAGE?: ReceiptStorage;
}

interface ReceiptApiConfig {
  network: Network;
  rpcUrl: string;
  packageId: string;
}

type ReceiptClient = Pick<SuiClient, "queryEvents">;
type SdkReceiptClient = Parameters<typeof querySettlementReceipts>[0]["client"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Admin-Token",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function parseNetwork(value: string | undefined): Network {
  if (value === undefined || value === "" || value === "testnet") return "testnet";
  if (value === "mainnet") return "mainnet";
  throw new Error("SUI_NETWORK must be testnet or mainnet.");
}

function resolveConfig(env: ReceiptApiEnv): ReceiptApiConfig {
  const network = parseNetwork(env.SUI_NETWORK);
  const packageId = env.OPENRAILS_PACKAGE_ID;
  if (!packageId || !isHexId(packageId)) {
    throw new Error("OPENRAILS_PACKAGE_ID must be configured as a Sui package ID.");
  }

  return {
    network,
    rpcUrl: env.SUI_RPC_URL || RPC_URLS[network],
    packageId,
  };
}

function isHexId(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value);
}

function parsePositiveInt(
  value: string | null,
  name: string,
  fallback: number,
  max: number
): number {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be between 1 and ${max}.`);
  }
  return parsed;
}

function parseCursor(url: URL): EventId | null {
  const txDigest = url.searchParams.get("cursorTxDigest");
  const eventSeq = url.searchParams.get("cursorEventSeq");
  if (!txDigest && !eventSeq) return null;
  if (!txDigest || !eventSeq) {
    throw new Error("cursorTxDigest and cursorEventSeq must be provided together.");
  }
  return { txDigest, eventSeq };
}

function parseEventCursor(url: URL): string | null {
  const value = url.searchParams.get("cursor");
  if (value === null || value === "") return null;
  return value;
}

function parseSettlementType(value: string | null): SettlementType | undefined {
  if (value === null || value === "") return undefined;
  if (value === "depleted" || value === "0") return SETTLEMENT_TYPE_DEPLETED;
  if (value === "expired" || value === "1") return SETTLEMENT_TYPE_EXPIRED;
  if (value === "cancelled" || value === "2") return SETTLEMENT_TYPE_CANCELLED;
  throw new Error("settlementType must be depleted, expired, cancelled, 0, 1, or 2.");
}

function parseOptionalHexId(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  if (value === null || value === "") return undefined;
  if (!isHexId(value)) throw new Error(`${name} must be a 0x-prefixed hex ID.`);
  return value;
}

function createClient(config: ReceiptApiConfig, override?: ReceiptClient): ReceiptClient {
  return override && typeof override.queryEvents === "function"
    ? override
    : new SuiClient({ url: config.rpcUrl });
}

type InspectClient = Pick<SuiClient, "devInspectTransactionBlock">;

function createInspectClient(config: ReceiptApiConfig, override?: InspectClient): InspectClient {
  return override && typeof override.devInspectTransactionBlock === "function"
    ? override
    : new SuiClient({ url: config.rpcUrl });
}

/**
 * GET /v1/nonces/:nonceAccountId/:lane — the lane's next expected nonce value, read
 * read-only via devInspect of nonce_account::next_nonce. (Resolution by payer address
 * is deferred: NonceAccount is shared and create_nonce_account emits no event, so there
 * is no on-chain payer->object index yet — a future NonceAccountCreated event enables it.)
 */
async function handleGetNonce(
  nonceAccountId: string,
  lane: string,
  config: ReceiptApiConfig,
  inspectOverride?: InspectClient
): Promise<Response> {
  if (!isHexId(nonceAccountId)) {
    throw new Error("nonceAccountId must be a 0x-prefixed hex ID.");
  }
  if (!/^\d+$/.test(lane)) {
    throw new Error("lane must be a non-negative integer.");
  }

  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::nonce_account::next_nonce`,
    arguments: [tx.object(nonceAccountId), tx.pure.u64(BigInt(lane))],
  });

  const client = createInspectClient(config, inspectOverride);
  const res = await client.devInspectTransactionBlock({
    sender: "0x0000000000000000000000000000000000000000000000000000000000000000",
    transactionBlock: tx,
  });

  const ret = res.results?.[0]?.returnValues?.[0];
  if (!ret) {
    return errorResponse(404, "not_found", "NonceAccount not found or returned no value.");
  }
  const [bytes] = ret as [number[], string];
  const nextNonce = bcs.u64().parse(Uint8Array.from(bytes));

  return jsonResponse({ nonceAccountId, lane, nextNonce });
}

function getStorage(env: ReceiptApiEnv): ReceiptStorage | null {
  if (env.RECEIPT_STORAGE) return env.RECEIPT_STORAGE;
  if (env.RECEIPT_DB) return createD1ReceiptStorage(env.RECEIPT_DB);
  return null;
}

function getAdminToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return request.headers.get("X-Admin-Token");
}

function requireConfiguredStorage(env: ReceiptApiEnv): ReceiptStorage {
  const storage = getStorage(env);
  if (!storage) throw new Error("RECEIPT_DB must be configured.");
  return storage;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSignedGatewayEvent(value: unknown): value is SignedGatewayEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (
    event.schemaVersion !== "1" ||
    !isNonEmptyString(event.eventId) ||
    !isNonEmptyString(event.eventType) ||
    !isNonEmptyString(event.paycardId) ||
    !isSafeNonNegativeInteger(event.timestamp) ||
    !isSafeNonNegativeInteger(event.sequence) ||
    !isNonEmptyString(event.signature)
  ) {
    return false;
  }

  if (event.eventType === "stream.accrual_heartbeat") {
    return (
      isNonEmptyString(event.accruedSinceCheckpoint) &&
      isNonEmptyString(event.projectedBalance) &&
      typeof event.isExhausted === "boolean"
    );
  }
  if (event.eventType === "channel.buffer_low") {
    return isNonEmptyString(event.projectedBalance) && isNonEmptyString(event.threshold);
  }
  if (event.eventType === "channel.terminated") {
    return (
      isSafeNonNegativeInteger(event.settlementType) &&
      isNonEmptyString(event.totalPaidToRecipient) &&
      isNonEmptyString(event.residualReturnedToPayer) &&
      isSafeNonNegativeInteger(event.closedAtSeconds)
    );
  }
  return false;
}

async function readGatewayEvent(request: Request): Promise<SignedGatewayEvent> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
  if (!isSignedGatewayEvent(body)) {
    throw new Error("Request body must be a signed gateway event.");
  }
  if (!isHexId(body.paycardId)) {
    throw new Error("paycardId must be a 0x-prefixed hex ID.");
  }
  return body;
}

function storedGatewayEvent(event: SignedGatewayEvent): StoredGatewayEvent {
  return {
    eventId: event.eventId,
    paycardId: event.paycardId,
    eventType: event.eventType,
    sequence: event.sequence,
    timestamp: event.timestamp,
    payload: event,
    payloadJson: stableJson(event),
    createdAtMs: Date.now(),
  };
}

function paycardStateFromEvent(event: SignedGatewayEvent): PaycardState {
  return {
    paycardId: event.paycardId,
    latestEventId: event.eventId,
    latestEventType: event.eventType,
    latestSequence: event.sequence,
    latestTimestamp: event.timestamp,
    payload: event,
    updatedAtMs: Date.now(),
  };
}

async function handleListReceipts(
  url: URL,
  config: ReceiptApiConfig,
  storage?: ReceiptStorage | null,
  clientOverride?: ReceiptClient
): Promise<Response> {
  const limit = parsePositiveInt(url.searchParams.get("limit"), "limit", 50, 100);
  const order = url.searchParams.get("order") ?? "descending";
  if (order !== "ascending" && order !== "descending") {
    throw new Error("order must be ascending or descending.");
  }

  const params = {
    cursor: parseCursor(url),
    limit,
    descendingOrder: order === "descending",
    paycardId: parseOptionalHexId(url, "paycardId"),
    payer: parseOptionalHexId(url, "payer"),
    recipient: parseOptionalHexId(url, "recipient"),
    settlementType: parseSettlementType(url.searchParams.get("settlementType")),
  };

  const page = storage
    ? await storage.listSettlementReceipts(params)
    : await querySettlementReceipts({
        client: createClient(config, clientOverride) as unknown as SdkReceiptClient,
        packageId: config.packageId,
        ...params,
      });

  return jsonResponse({
    data: page.data,
    nextCursor: page.nextCursor,
    hasNextPage: page.hasNextPage,
  });
}

async function handleGetReceipt(
  paycardId: string,
  url: URL,
  config: ReceiptApiConfig,
  storage?: ReceiptStorage | null,
  clientOverride?: ReceiptClient
): Promise<Response> {
  if (!isHexId(paycardId)) {
    throw new Error("paycardId must be a 0x-prefixed hex ID.");
  }

  const receipt = storage
    ? await storage.getSettlementReceiptByPaycardId(paycardId)
    : await getSettlementReceiptByPaycardId({
        client: createClient(config, clientOverride) as unknown as SdkReceiptClient,
        packageId: config.packageId,
        paycardId,
        limit: parsePositiveInt(url.searchParams.get("limit"), "limit", 50, 100),
        maxPages: parsePositiveInt(url.searchParams.get("maxPages"), "maxPages", 5, 20),
      });

  if (!receipt) {
    return errorResponse(404, "receipt_not_found", "No terminal receipt found for this Paycard.");
  }
  return jsonResponse({ data: receipt });
}

async function handleGatewayEvent(request: Request, env: ReceiptApiEnv): Promise<Response> {
  const publicKey = env.GATEWAY_PUBLIC_KEY_HEX;
  if (!publicKey) {
    return errorResponse(500, "configuration_error", "GATEWAY_PUBLIC_KEY_HEX must be configured.");
  }

  const storage = requireConfiguredStorage(env);
  const event = await readGatewayEvent(request);
  const verified = await verifyGatewayEvent(event, publicKey);
  if (!verified) {
    return errorResponse(401, "invalid_signature", "Gateway event signature verification failed.");
  }

  const stored = storedGatewayEvent(event);
  const result = await storage.putGatewayEvent(stored);
  if (result.status === "conflict") {
    return errorResponse(409, "duplicate_event_conflict", "A different event already exists for this eventId.");
  }

  let stateUpdated = false;
  if (result.status === "inserted") {
    stateUpdated = await storage.updatePaycardStateIfNewer(paycardStateFromEvent(event));
  }

  return jsonResponse({
    data: {
      eventId: event.eventId,
      paycardId: event.paycardId,
      stored: true,
      duplicate: result.status === "duplicate",
      stateUpdated,
    },
  }, result.status === "inserted" ? 202 : 200);
}

async function handleGetStream(paycardId: string, env: ReceiptApiEnv): Promise<Response> {
  if (!isHexId(paycardId)) {
    throw new Error("paycardId must be a 0x-prefixed hex ID.");
  }
  const state = await requireConfiguredStorage(env).getPaycardState(paycardId);
  if (!state) {
    return errorResponse(404, "stream_not_found", "No indexed stream state found for this Paycard.");
  }
  return jsonResponse({ data: state });
}

async function handleListStreamEvents(paycardId: string, url: URL, env: ReceiptApiEnv): Promise<Response> {
  if (!isHexId(paycardId)) {
    throw new Error("paycardId must be a 0x-prefixed hex ID.");
  }
  const limit = parsePositiveInt(url.searchParams.get("limit"), "limit", 50, 100);
  const page = await requireConfiguredStorage(env).listGatewayEvents(paycardId, limit, parseEventCursor(url));
  return jsonResponse({
    data: page.data,
    nextCursor: page.nextCursor,
    hasNextPage: page.hasNextPage,
  });
}

function proofStreamState(state: PaycardState): OpenRailsProofStreamState {
  return {
    paycardId: state.paycardId,
    latestEventId: state.latestEventId,
    latestEventType: state.latestEventType as OpenRailsProofStreamState["latestEventType"],
    latestSequence: state.latestSequence,
    latestTimestamp: state.latestTimestamp,
    payload: state.payload,
    updatedAtMs: state.updatedAtMs,
  };
}

async function handleGetProof(
  paycardId: string,
  url: URL,
  config: ReceiptApiConfig,
  storage?: ReceiptStorage | null,
  clientOverride?: ReceiptClient
): Promise<Response> {
  if (!isHexId(paycardId)) {
    throw new Error("paycardId must be a 0x-prefixed hex ID.");
  }

  const limit = parsePositiveInt(url.searchParams.get("limit"), "limit", 10, 50);
  const [latestStreamState, recentStreamEvents, terminalReceipt] = storage
    ? await Promise.all([
        storage.getPaycardState(paycardId),
        storage.listRecentGatewayEvents(paycardId, limit),
        storage.getSettlementReceiptByPaycardId(paycardId),
      ])
    : await Promise.all([
        Promise.resolve(null),
        Promise.resolve([]),
        getSettlementReceiptByPaycardId({
          client: createClient(config, clientOverride) as unknown as SdkReceiptClient,
          packageId: config.packageId,
          paycardId,
          limit: parsePositiveInt(url.searchParams.get("receiptLimit"), "receiptLimit", 50, 100),
          maxPages: parsePositiveInt(url.searchParams.get("maxPages"), "maxPages", 5, 20),
        }),
      ]);

  if (!latestStreamState && recentStreamEvents.length === 0 && !terminalReceipt) {
    return errorResponse(404, "proof_not_found", "No proof data found for this Paycard.");
  }

  return jsonResponse({
    data: buildOpenRailsProof({
      network: config.network,
      packageId: config.packageId,
      paycardId,
      latestStreamState: latestStreamState ? proofStreamState(latestStreamState) : null,
      recentStreamEvents: recentStreamEvents.map((event) =>
        gatewayEventMetadata({
          ...event,
          eventType: event.eventType as OpenRailsProofStreamState["latestEventType"],
        })
      ),
      terminalReceipt,
    }),
  });
}

async function handleRunReceiptIndexer(
  request: Request,
  env: ReceiptApiEnv,
  config: ReceiptApiConfig,
  clientOverride?: ReceiptClient
): Promise<Response> {
  if (!env.ADMIN_TOKEN) {
    return errorResponse(500, "configuration_error", "ADMIN_TOKEN must be configured.");
  }
  if (getAdminToken(request) !== env.ADMIN_TOKEN) {
    return errorResponse(401, "unauthorized", "Invalid admin token.");
  }

  const result = await runReceiptIndexer(config, requireConfiguredStorage(env), clientOverride);
  return jsonResponse({ data: result });
}

export async function handleRequest(
  request: Request,
  env: ReceiptApiEnv = {},
  clientOverride?: ReceiptClient,
  inspectOverride?: InspectClient
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "GET" && request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Only GET and POST are supported.");
  }

  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return jsonResponse({ ok: true });
  }

  try {
    if (request.method === "POST" && url.pathname === "/v1/gateway/events") {
      return await handleGatewayEvent(request, env);
    }

    if (request.method === "GET") {
      const streamEventsMatch = url.pathname.match(/^\/v1\/streams\/([^/]+)\/events$/);
      if (streamEventsMatch) {
        return await handleListStreamEvents(decodeURIComponent(streamEventsMatch[1]), url, env);
      }

      const streamMatch = url.pathname.match(/^\/v1\/streams\/([^/]+)$/);
      if (streamMatch) {
        return await handleGetStream(decodeURIComponent(streamMatch[1]), env);
      }
    }

    let config: ReceiptApiConfig;
    try {
      config = resolveConfig(env);
    } catch (error) {
      return errorResponse(500, "configuration_error", (error as Error).message);
    }

    if (request.method === "POST" && url.pathname === "/admin/index/receipts/run") {
      return await handleRunReceiptIndexer(request, env, config, clientOverride);
    }

    if (request.method !== "GET") {
      return errorResponse(404, "not_found", "Route not found.");
    }

    const storage = getStorage(env);

    if (url.pathname === "/v1/receipts") {
      return await handleListReceipts(url, config, storage, clientOverride);
    }

    const proofMatch = url.pathname.match(/^\/v1\/proofs\/([^/]+)$/);
    if (proofMatch) {
      return await handleGetProof(decodeURIComponent(proofMatch[1]), url, config, storage, clientOverride);
    }

    const nonceMatch = url.pathname.match(/^\/v1\/nonces\/([^/]+)\/([^/]+)$/);
    if (nonceMatch) {
      return await handleGetNonce(
        decodeURIComponent(nonceMatch[1]),
        decodeURIComponent(nonceMatch[2]),
        config,
        inspectOverride
      );
    }

    const match = url.pathname.match(/^\/v1\/receipts\/([^/]+)$/);
    if (match) {
      return await handleGetReceipt(decodeURIComponent(match[1]), url, config, storage, clientOverride);
    }

    return errorResponse(404, "not_found", "Route not found.");
  } catch (error) {
    const message = (error as Error).message;
    if (
      message.includes("must be") ||
      message.includes("provided together") ||
      message.includes("between") ||
      message.includes("valid JSON")
    ) {
      return errorResponse(400, "invalid_request", message);
    }
    if (message.includes("RECEIPT_DB")) {
      return errorResponse(503, "storage_unavailable", message);
    }
    return errorResponse(502, "sui_rpc_unavailable", "Unable to query Sui receipt events.");
  }
}

export default {
  fetch(request: Request, env: ReceiptApiEnv): Promise<Response> {
    return handleRequest(request, env);
  },
  scheduled(_controller: ScheduledController, env: ReceiptApiEnv, ctx: ExecutionContext): void {
    ctx.waitUntil((async () => {
      const config = resolveConfig(env);
      await runReceiptIndexer(config, requireConfiguredStorage(env));
    })());
  },
};
