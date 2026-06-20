import type {
  IndexedSettlementReceiptV1,
  SettlementReceiptPage,
  SettlementType,
  SignedGatewayEvent,
} from "@openrails/sdk/worker";

type EventId = { txDigest: string; eventSeq: string };

export interface StoredGatewayEvent {
  eventId: string;
  paycardId: string;
  eventType: string;
  sequence: number;
  timestamp: number;
  payload: SignedGatewayEvent;
  payloadJson: string;
  createdAtMs: number;
}

export interface PaycardState {
  paycardId: string;
  latestEventId: string;
  latestEventType: string;
  latestSequence: number;
  latestTimestamp: number;
  payload: SignedGatewayEvent;
  updatedAtMs: number;
}

export interface GatewayEventPage {
  data: StoredGatewayEvent[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

export interface PutGatewayEventResult {
  status: "inserted" | "duplicate" | "conflict";
  existing?: StoredGatewayEvent;
}

export interface ListSettlementReceiptsParams {
  cursor?: EventId | null;
  limit: number;
  descendingOrder: boolean;
  paycardId?: string;
  payer?: string;
  recipient?: string;
  settlementType?: SettlementType;
}

export interface IndexerState {
  name: string;
  cursor: EventId | null;
  updatedAtMs: number;
}

export interface ReceiptStorage {
  getGatewayEvent(eventId: string): Promise<StoredGatewayEvent | null>;
  putGatewayEvent(event: StoredGatewayEvent): Promise<PutGatewayEventResult>;
  getPaycardState(paycardId: string): Promise<PaycardState | null>;
  updatePaycardStateIfNewer(state: PaycardState): Promise<boolean>;
  listGatewayEvents(paycardId: string, limit: number, cursor?: string | null): Promise<GatewayEventPage>;
  listRecentGatewayEvents(paycardId: string, limit: number): Promise<StoredGatewayEvent[]>;
  putSettlementReceipts(receipts: IndexedSettlementReceiptV1[]): Promise<void>;
  listSettlementReceipts(params: ListSettlementReceiptsParams): Promise<SettlementReceiptPage>;
  getSettlementReceiptByPaycardId(paycardId: string): Promise<IndexedSettlementReceiptV1 | null>;
  getIndexerState(name: string): Promise<IndexerState | null>;
  setIndexerState(name: string, cursor: EventId | null): Promise<void>;
}

interface StoredSettlementReceipt {
  receiptId: string;
  paycardId: string;
  payer: string;
  recipient: string;
  settlementType: SettlementType;
  transactionDigest: string;
  eventSeq: string;
  payload: IndexedSettlementReceiptV1;
  payloadJson: string;
  indexedAtMs: number;
}

function receiptTransactionDigest(receipt: IndexedSettlementReceiptV1): string {
  return receipt.transactionDigest ?? receipt.eventId.txDigest;
}

function receiptId(receipt: IndexedSettlementReceiptV1): string {
  return `${receiptTransactionDigest(receipt)}:${receipt.eventSeq}`;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function compareGatewayEvents(a: Pick<StoredGatewayEvent, "sequence" | "timestamp" | "eventId">, b: Pick<StoredGatewayEvent, "sequence" | "timestamp" | "eventId">): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return a.eventId.localeCompare(b.eventId);
}

function isNewerState(incoming: PaycardState, existing: PaycardState): boolean {
  return compareGatewayEvents(
    { eventId: incoming.latestEventId, sequence: incoming.latestSequence, timestamp: incoming.latestTimestamp },
    { eventId: existing.latestEventId, sequence: existing.latestSequence, timestamp: existing.latestTimestamp }
  ) >= 0;
}

function toEventId(receipt: StoredSettlementReceipt): EventId {
  return { txDigest: receipt.transactionDigest, eventSeq: receipt.eventSeq };
}

function matchesReceiptFilters(
  receipt: StoredSettlementReceipt,
  params: Pick<ListSettlementReceiptsParams, "paycardId" | "payer" | "recipient" | "settlementType">
): boolean {
  return (
    (params.paycardId === undefined || receipt.paycardId === params.paycardId) &&
    (params.payer === undefined || receipt.payer === params.payer) &&
    (params.recipient === undefined || receipt.recipient === params.recipient) &&
    (params.settlementType === undefined || receipt.settlementType === params.settlementType)
  );
}

function settlementCursorId(cursor: EventId): string {
  return `${cursor.txDigest}:${cursor.eventSeq}`;
}

function compareSettlementReceipts(a: StoredSettlementReceipt, b: StoredSettlementReceipt): number {
  if (a.indexedAtMs !== b.indexedAtMs) return a.indexedAtMs - b.indexedAtMs;
  return a.receiptId.localeCompare(b.receiptId);
}

export function createInMemoryReceiptStorage(): ReceiptStorage {
  const gatewayEvents = new Map<string, StoredGatewayEvent>();
  const paycardStates = new Map<string, PaycardState>();
  const settlementReceipts = new Map<string, StoredSettlementReceipt>();
  const indexerStates = new Map<string, IndexerState>();

  function sortedSettlementReceipts(descending: boolean): StoredSettlementReceipt[] {
    const data = Array.from(settlementReceipts.values()).sort(compareSettlementReceipts);
    return descending ? data.reverse() : data;
  }

  return {
    async getGatewayEvent(eventId) {
      return gatewayEvents.get(eventId) ?? null;
    },
    async putGatewayEvent(event) {
      const existing = gatewayEvents.get(event.eventId);
      if (existing) {
        return existing.payloadJson === event.payloadJson
          ? { status: "duplicate", existing }
          : { status: "conflict", existing };
      }
      gatewayEvents.set(event.eventId, event);
      return { status: "inserted" };
    },
    async getPaycardState(paycardId) {
      return paycardStates.get(paycardId) ?? null;
    },
    async updatePaycardStateIfNewer(state) {
      const existing = paycardStates.get(state.paycardId);
      if (existing && !isNewerState(state, existing)) return false;
      paycardStates.set(state.paycardId, state);
      return true;
    },
    async listGatewayEvents(paycardId, limit, cursor = null) {
      let events = Array.from(gatewayEvents.values())
        .filter((event) => event.paycardId === paycardId)
        .sort(compareGatewayEvents);

      if (cursor) {
        const cursorEvent = gatewayEvents.get(cursor);
        if (cursorEvent) {
          events = events.filter((event) => compareGatewayEvents(event, cursorEvent) > 0);
        }
      }

      const page = events.slice(0, limit + 1);
      const hasNextPage = page.length > limit;
      const data = hasNextPage ? page.slice(0, limit) : page;
      return {
        data,
        hasNextPage,
        nextCursor: hasNextPage && data.length > 0 ? data[data.length - 1].eventId : null,
      };
    },
    async listRecentGatewayEvents(paycardId, limit) {
      return Array.from(gatewayEvents.values())
        .filter((event) => event.paycardId === paycardId)
        .sort((a, b) => compareGatewayEvents(b, a))
        .slice(0, limit);
    },
    async putSettlementReceipts(receipts) {
      const now = Date.now();
      for (const receipt of receipts) {
        const id = receiptId(receipt);
        const existing = settlementReceipts.get(id);
        settlementReceipts.set(id, {
          receiptId: id,
          paycardId: receipt.paycardId,
          payer: receipt.payer,
          recipient: receipt.recipient,
          settlementType: receipt.settlementType,
          transactionDigest: receiptTransactionDigest(receipt),
          eventSeq: receipt.eventSeq,
          payload: receipt,
          payloadJson: stableJson(receipt),
          indexedAtMs: existing?.indexedAtMs ?? now,
        });
      }
    },
    async listSettlementReceipts(params) {
      let receipts = sortedSettlementReceipts(params.descendingOrder).filter((receipt) =>
        matchesReceiptFilters(receipt, params)
      );

      if (params.cursor) {
        const cursorId = settlementCursorId(params.cursor);
        const cursorIndex = receipts.findIndex((receipt) => receipt.receiptId === cursorId);
        if (cursorIndex >= 0) receipts = receipts.slice(cursorIndex + 1);
      }

      const page = receipts.slice(0, params.limit + 1);
      const hasNextPage = page.length > params.limit;
      const data = hasNextPage ? page.slice(0, params.limit) : page;
      return {
        data: data.map((receipt) => receipt.payload),
        hasNextPage,
        nextCursor: hasNextPage && data.length > 0 ? toEventId(data[data.length - 1]) : null,
      };
    },
    async getSettlementReceiptByPaycardId(paycardId) {
      return sortedSettlementReceipts(true).find((receipt) => receipt.paycardId === paycardId)?.payload ?? null;
    },
    async getIndexerState(name) {
      return indexerStates.get(name) ?? null;
    },
    async setIndexerState(name, cursor) {
      indexerStates.set(name, { name, cursor, updatedAtMs: Date.now() });
    },
  };
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

function gatewayEventFromRow(row: Record<string, unknown>): StoredGatewayEvent {
  return {
    eventId: String(row.event_id),
    paycardId: String(row.paycard_id),
    eventType: String(row.event_type),
    sequence: Number(row.event_sequence),
    timestamp: Number(row.event_timestamp),
    payload: parseJson<SignedGatewayEvent>(String(row.payload_json)),
    payloadJson: String(row.payload_json),
    createdAtMs: Number(row.created_at_ms),
  };
}

function paycardStateFromRow(row: Record<string, unknown>): PaycardState {
  return {
    paycardId: String(row.paycard_id),
    latestEventId: String(row.latest_event_id),
    latestEventType: String(row.latest_event_type),
    latestSequence: Number(row.latest_sequence),
    latestTimestamp: Number(row.latest_timestamp),
    payload: parseJson<SignedGatewayEvent>(String(row.state_json)),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

function settlementReceiptFromRow(row: Record<string, unknown>): StoredSettlementReceipt {
  const payload = parseJson<IndexedSettlementReceiptV1>(String(row.payload_json));
  return {
    receiptId: String(row.receipt_id),
    paycardId: String(row.paycard_id),
    payer: String(row.payer),
    recipient: String(row.recipient),
    settlementType: Number(row.settlement_type) as SettlementType,
    transactionDigest: String(row.transaction_digest),
    eventSeq: String(row.event_seq),
    payload,
    payloadJson: String(row.payload_json),
    indexedAtMs: Number(row.indexed_at_ms),
  };
}

export function createD1ReceiptStorage(db: D1Database): ReceiptStorage {
  return {
    async getGatewayEvent(eventId) {
      const row = await db.prepare("SELECT * FROM gateway_events WHERE event_id = ?").bind(eventId).first<Record<string, unknown>>();
      return row ? gatewayEventFromRow(row) : null;
    },
    async putGatewayEvent(event) {
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO gateway_events
            (event_id, paycard_id, event_type, event_sequence, event_timestamp, payload_json, created_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          event.eventId,
          event.paycardId,
          event.eventType,
          event.sequence,
          event.timestamp,
          event.payloadJson,
          event.createdAtMs
        )
        .run();

      const existing = await this.getGatewayEvent(event.eventId);
      if (!existing) throw new Error("Gateway event insert did not return a stored row.");
      if (existing.payloadJson !== event.payloadJson) return { status: "conflict", existing };
      return result.meta.changes > 0
        ? { status: "inserted" }
        : { status: "duplicate", existing };
    },
    async getPaycardState(paycardId) {
      const row = await db.prepare("SELECT * FROM paycard_states WHERE paycard_id = ?").bind(paycardId).first<Record<string, unknown>>();
      return row ? paycardStateFromRow(row) : null;
    },
    async updatePaycardStateIfNewer(state) {
      const result = await db
        .prepare(
          `INSERT INTO paycard_states
            (paycard_id, latest_event_id, latest_event_type, latest_sequence, latest_timestamp, state_json, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(paycard_id) DO UPDATE SET
             latest_event_id = excluded.latest_event_id,
             latest_event_type = excluded.latest_event_type,
             latest_sequence = excluded.latest_sequence,
             latest_timestamp = excluded.latest_timestamp,
             state_json = excluded.state_json,
             updated_at_ms = excluded.updated_at_ms
           WHERE
             excluded.latest_sequence > paycard_states.latest_sequence OR
             (excluded.latest_sequence = paycard_states.latest_sequence AND excluded.latest_timestamp > paycard_states.latest_timestamp) OR
             (excluded.latest_sequence = paycard_states.latest_sequence AND excluded.latest_timestamp = paycard_states.latest_timestamp AND excluded.latest_event_id >= paycard_states.latest_event_id)`
        )
        .bind(
          state.paycardId,
          state.latestEventId,
          state.latestEventType,
          state.latestSequence,
          state.latestTimestamp,
          stableJson(state.payload),
          state.updatedAtMs
        )
        .run();
      return result.meta.changes > 0;
    },
    async listGatewayEvents(paycardId, limit, cursor = null) {
      const bindings: unknown[] = [paycardId];
      let cursorClause = "";
      if (cursor) {
        const cursorEvent = await this.getGatewayEvent(cursor);
        if (cursorEvent) {
          cursorClause =
            " AND (event_sequence > ? OR (event_sequence = ? AND event_timestamp > ?) OR (event_sequence = ? AND event_timestamp = ? AND event_id > ?))";
          bindings.push(
            cursorEvent.sequence,
            cursorEvent.sequence,
            cursorEvent.timestamp,
            cursorEvent.sequence,
            cursorEvent.timestamp,
            cursorEvent.eventId
          );
        }
      }
      bindings.push(limit + 1);

      const result = await db
        .prepare(
          `SELECT * FROM gateway_events
           WHERE paycard_id = ?${cursorClause}
           ORDER BY event_sequence ASC, event_timestamp ASC, event_id ASC
           LIMIT ?`
        )
        .bind(...bindings)
        .all<Record<string, unknown>>();
      const page = (result.results ?? []).map(gatewayEventFromRow);
      const hasNextPage = page.length > limit;
      const data = hasNextPage ? page.slice(0, limit) : page;
      return {
        data,
        hasNextPage,
        nextCursor: hasNextPage && data.length > 0 ? data[data.length - 1].eventId : null,
      };
    },
    async listRecentGatewayEvents(paycardId, limit) {
      const result = await db
        .prepare(
          `SELECT * FROM gateway_events
           WHERE paycard_id = ?
           ORDER BY event_sequence DESC, event_timestamp DESC, event_id DESC
           LIMIT ?`
        )
        .bind(paycardId, limit)
        .all<Record<string, unknown>>();
      return (result.results ?? []).map(gatewayEventFromRow);
    },
    async putSettlementReceipts(receipts) {
      const now = Date.now();
      for (const receipt of receipts) {
        const id = receiptId(receipt);
        const existing = await db
          .prepare("SELECT indexed_at_ms FROM settlement_receipts WHERE receipt_id = ?")
          .bind(id)
          .first<{ indexed_at_ms: number }>();
        await db
          .prepare(
            `INSERT INTO settlement_receipts
              (receipt_id, paycard_id, payer, recipient, settlement_type, transaction_digest, event_seq, payload_json, indexed_at_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(receipt_id) DO UPDATE SET
               paycard_id = excluded.paycard_id,
               payer = excluded.payer,
               recipient = excluded.recipient,
               settlement_type = excluded.settlement_type,
               transaction_digest = excluded.transaction_digest,
               event_seq = excluded.event_seq,
               payload_json = excluded.payload_json`
          )
          .bind(
            id,
            receipt.paycardId,
            receipt.payer,
            receipt.recipient,
            receipt.settlementType,
            receiptTransactionDigest(receipt),
            receipt.eventSeq,
            stableJson(receipt),
            existing?.indexed_at_ms ?? now
          )
          .run();
      }
    },
    async listSettlementReceipts(params) {
      const conditions: string[] = [];
      const bindings: unknown[] = [];
      if (params.paycardId !== undefined) {
        conditions.push("paycard_id = ?");
        bindings.push(params.paycardId);
      }
      if (params.payer !== undefined) {
        conditions.push("payer = ?");
        bindings.push(params.payer);
      }
      if (params.recipient !== undefined) {
        conditions.push("recipient = ?");
        bindings.push(params.recipient);
      }
      if (params.settlementType !== undefined) {
        conditions.push("settlement_type = ?");
        bindings.push(params.settlementType);
      }
      if (params.cursor) {
        const cursorId = settlementCursorId(params.cursor);
        const cursorRow = await db
          .prepare("SELECT indexed_at_ms, receipt_id FROM settlement_receipts WHERE receipt_id = ?")
          .bind(cursorId)
          .first<{ indexed_at_ms: number; receipt_id: string }>();
        if (cursorRow) {
          const op = params.descendingOrder ? "<" : ">";
          conditions.push(`(indexed_at_ms ${op} ? OR (indexed_at_ms = ? AND receipt_id ${op} ?))`);
          bindings.push(cursorRow.indexed_at_ms, cursorRow.indexed_at_ms, cursorRow.receipt_id);
        }
      }

      bindings.push(params.limit + 1);
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const direction = params.descendingOrder ? "DESC" : "ASC";
      const result = await db
        .prepare(
          `SELECT * FROM settlement_receipts
           ${where}
           ORDER BY indexed_at_ms ${direction}, receipt_id ${direction}
           LIMIT ?`
        )
        .bind(...bindings)
        .all<Record<string, unknown>>();
      const page = (result.results ?? []).map(settlementReceiptFromRow);
      const hasNextPage = page.length > params.limit;
      const data = hasNextPage ? page.slice(0, params.limit) : page;
      return {
        data: data.map((receipt) => receipt.payload),
        hasNextPage,
        nextCursor: hasNextPage && data.length > 0 ? toEventId(data[data.length - 1]) : null,
      };
    },
    async getSettlementReceiptByPaycardId(paycardId) {
      const row = await db
        .prepare(
          `SELECT * FROM settlement_receipts
           WHERE paycard_id = ?
           ORDER BY indexed_at_ms DESC, receipt_id DESC
           LIMIT 1`
        )
        .bind(paycardId)
        .first<Record<string, unknown>>();
      return row ? settlementReceiptFromRow(row).payload : null;
    },
    async getIndexerState(name) {
      const row = await db.prepare("SELECT * FROM indexer_state WHERE indexer_name = ?").bind(name).first<Record<string, unknown>>();
      if (!row) return null;
      const txDigest = row.cursor_tx_digest === null ? null : String(row.cursor_tx_digest);
      const eventSeq = row.cursor_event_seq === null ? null : String(row.cursor_event_seq);
      return {
        name: String(row.indexer_name),
        cursor: txDigest && eventSeq ? { txDigest, eventSeq } : null,
        updatedAtMs: Number(row.updated_at_ms),
      };
    },
    async setIndexerState(name, cursor) {
      await db
        .prepare(
          `INSERT INTO indexer_state (indexer_name, cursor_tx_digest, cursor_event_seq, updated_at_ms)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(indexer_name) DO UPDATE SET
             cursor_tx_digest = excluded.cursor_tx_digest,
             cursor_event_seq = excluded.cursor_event_seq,
             updated_at_ms = excluded.updated_at_ms`
        )
        .bind(name, cursor?.txDigest ?? null, cursor?.eventSeq ?? null, Date.now())
        .run();
    },
  };
}
