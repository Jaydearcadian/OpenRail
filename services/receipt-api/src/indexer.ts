import {
  parseSettlementReceiptEvent,
  type IndexedSettlementReceiptV1,
} from "@openrails/sdk/worker";
import { SuiClient } from "@mysten/sui/client";
import type { ReceiptStorage } from "./storage.js";

type EventId = { txDigest: string; eventSeq: string };
type ReceiptClient = Pick<SuiClient, "queryEvents">;

export interface ReceiptIndexerConfig {
  packageId: string;
  rpcUrl: string;
}

export interface ReceiptIndexerResult {
  indexed: number;
  cursor: EventId | null;
  hasNextPage: boolean;
}

const INDEXER_NAME = "settlement_receipts_v1";

export async function runReceiptIndexer(
  config: ReceiptIndexerConfig,
  storage: ReceiptStorage,
  clientOverride?: ReceiptClient
): Promise<ReceiptIndexerResult> {
  const state = await storage.getIndexerState(INDEXER_NAME);
  const client = clientOverride && typeof clientOverride.queryEvents === "function"
    ? clientOverride
    : new SuiClient({ url: config.rpcUrl });

  const page = await client.queryEvents({
    query: {
      MoveEventType: `${config.packageId}::events::SettlementReceipt`,
    },
    cursor: state?.cursor ?? undefined,
    limit: 50,
    order: "ascending",
  });

  const receipts = page.data
    .map(parseSettlementReceiptEvent)
    .filter((receipt): receipt is IndexedSettlementReceiptV1 => receipt !== null);

  await storage.putSettlementReceipts(receipts);

  const lastRawEvent = page.data.length > 0 ? page.data[page.data.length - 1].id : null;
  const nextCursor = page.nextCursor ?? lastRawEvent ?? state?.cursor ?? null;
  await storage.setIndexerState(INDEXER_NAME, nextCursor);

  return {
    indexed: receipts.length,
    cursor: nextCursor,
    hasNextPage: page.hasNextPage,
  };
}
