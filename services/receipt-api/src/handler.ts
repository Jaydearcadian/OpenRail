import {
  SETTLEMENT_TYPE_CANCELLED,
  SETTLEMENT_TYPE_DEPLETED,
  SETTLEMENT_TYPE_EXPIRED,
  SuiClient,
  getSettlementReceiptByPaycardId,
  querySettlementReceipts,
  type SettlementType,
} from "@openrails/sdk";

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
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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

async function handleListReceipts(
  url: URL,
  config: ReceiptApiConfig,
  clientOverride?: ReceiptClient
): Promise<Response> {
  const limit = parsePositiveInt(url.searchParams.get("limit"), "limit", 50, 100);
  const order = url.searchParams.get("order") ?? "descending";
  if (order !== "ascending" && order !== "descending") {
    throw new Error("order must be ascending or descending.");
  }

  const page = await querySettlementReceipts({
    client: createClient(config, clientOverride) as unknown as SdkReceiptClient,
    packageId: config.packageId,
    cursor: parseCursor(url),
    limit,
    descendingOrder: order === "descending",
    paycardId: parseOptionalHexId(url, "paycardId"),
    payer: parseOptionalHexId(url, "payer"),
    recipient: parseOptionalHexId(url, "recipient"),
    settlementType: parseSettlementType(url.searchParams.get("settlementType")),
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
  clientOverride?: ReceiptClient
): Promise<Response> {
  if (!isHexId(paycardId)) {
    throw new Error("paycardId must be a 0x-prefixed hex ID.");
  }

  const receipt = await getSettlementReceiptByPaycardId({
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

export async function handleRequest(
  request: Request,
  env: ReceiptApiEnv = {},
  clientOverride?: ReceiptClient
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "GET") {
    return errorResponse(405, "method_not_allowed", "Only GET is supported.");
  }

  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return jsonResponse({ ok: true });
  }

  let config: ReceiptApiConfig;
  try {
    config = resolveConfig(env);
  } catch (error) {
    return errorResponse(500, "configuration_error", (error as Error).message);
  }

  try {
    if (url.pathname === "/v1/receipts") {
      return await handleListReceipts(url, config, clientOverride);
    }

    const match = url.pathname.match(/^\/v1\/receipts\/([^/]+)$/);
    if (match) {
      return await handleGetReceipt(decodeURIComponent(match[1]), url, config, clientOverride);
    }

    return errorResponse(404, "not_found", "Route not found.");
  } catch (error) {
    const message = (error as Error).message;
    if (
      message.includes("must be") ||
      message.includes("provided together") ||
      message.includes("between")
    ) {
      return errorResponse(400, "invalid_request", message);
    }
    return errorResponse(502, "sui_rpc_unavailable", "Unable to query Sui receipt events.");
  }
}

export default {
  fetch(request: Request, env: ReceiptApiEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
