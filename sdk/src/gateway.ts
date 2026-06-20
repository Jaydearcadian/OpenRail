import { SuiClient } from "@mysten/sui/client";
import type { EventId } from "@mysten/sui/client";
import type { StreamState } from "./accrual.js";
import {
  buildBufferLowEvent,
  buildHeartbeat,
  buildTerminalEvent,
  type GatewayEventSigner,
  type GatewayTerminalEventInput,
  type SignedGatewayEvent,
} from "./heartbeat.js";
import {
  FileGatewayStore,
  InMemoryGatewayStore,
  type GatewayPersistedState,
  type GatewayStore,
  type PendingGatewayDelivery,
} from "./gateway-store.js";

export interface GatewaySigner extends GatewayEventSigner {
  getPublicKey(): { toRawBytes(): Uint8Array };
}

export interface GatewayConfig {
  suiRpcUrl: string;
  packageId: string;
  paycardIds: string[];
  webhookUrl: string;
  intervalMs?: number;           // Default: 10_000ms
  bufferLowThreshold?: bigint | string;
  signerKeypair: GatewaySigner;
  store?: GatewayStore;
  storePath?: string;
}

export interface GatewayHandle {
  stop(): void;
  publicKeyHex: string;          // Publish to merchants so they can verify heartbeats
}

// --- Object hydration ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hydrateStreamState(paycardId: string, fields: Record<string, any>): StreamState {
  const status: number =
    typeof fields.status === "number"
      ? fields.status
      : parseInt(fields.status as string, 10);

  // Balance<T> is represented as { value: "..." } in the Sui RPC JSON
  const poolValue: string =
    typeof fields.allocation_pool === "object" && fields.allocation_pool !== null
      ? (fields.allocation_pool.fields?.value ?? fields.allocation_pool.value ?? "0")
      : String(fields.allocation_pool ?? "0");

  return {
    paycardId,
    poolBalance:              BigInt(poolValue),
    initialAllocation:        BigInt(fields.initial_allocation as string),
    maxFlowRatePerSecond:     BigInt(fields.max_flow_rate_per_second as string),
    startTimestamp:           Number(fields.start_timestamp),
    durationSeconds:          Number(fields.duration_seconds),
    lastCheckpointTimestamp:  Number(fields.last_checkpoint_timestamp),
    status:                   status === 0 ? "active" : status === 3 ? "cancelled" : "depleted",
  };
}

// --- Webhook dispatch ---

async function dispatch(webhookUrl: string, payload: SignedGatewayEvent, attempts = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": payload.eventId,
          "X-OpenRails-Event-Id": payload.eventId,
          "X-OpenRails-Schema-Version": payload.schemaVersion,
        },
        body: JSON.stringify(payload),
      });
      if (response.ok) return true;
    } catch {
      // Retry below.
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
  return false;
}

function nextBackoffMs(attempts: number): number {
  return Math.min(30_000, 500 * 2 ** Math.min(attempts, 6));
}

function mergeInitialWatchlist(state: GatewayPersistedState, paycardIds: string[]): GatewayPersistedState {
  return {
    ...state,
    watchlist: [...new Set([...state.watchlist, ...paycardIds])],
  };
}

function normalizeMoveId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

// --- Main ---

/**
 * Starts the Dynamic Stream Event Gateway.
 *
 * Every intervalMs the gateway:
 *   1. Fetches each watched Paycard from the Sui RPC
 *   2. Projects off-chain accrual via calculateAccrualDebt
 *   3. Signs a StreamHeartbeat with the gateway keypair
 *   4. POSTs the signed payload to webhookUrl
 *
 * On detecting a SettlementReceipt event for a watched Paycard,
 * the gateway emits a signed terminal event and removes that Paycard
 * from the watch list only after delivery succeeds. When all Paycards
 * are settled and pending deliveries are empty, the gateway stops automatically.
 */
export async function startGateway(config: GatewayConfig): Promise<GatewayHandle> {
  const { suiRpcUrl, packageId, webhookUrl, signerKeypair } = config;
  const intervalMs = config.intervalMs ?? 10_000;
  const bufferLowThreshold = config.bufferLowThreshold === undefined
    ? undefined
    : BigInt(config.bufferLowThreshold);

  const client = new SuiClient({ url: suiRpcUrl });
  const publicKeyHex = Buffer.from(signerKeypair.getPublicKey().toRawBytes()).toString("hex");
  const store = config.store ?? (
    config.storePath ? new FileGatewayStore(config.storePath) : new InMemoryGatewayStore()
  );

  let persisted = mergeInitialWatchlist(await store.load(), config.paycardIds);

  // Mutable watch list. Paycards are removed only after terminal delivery succeeds.
  const watching = new Set<string>(persisted.watchlist);
  let eventCursor: EventId | null = persisted.cursor;
  let pendingDeliveries: PendingGatewayDelivery[] = [...persisted.pendingDeliveries];
  const sentEventIds = new Set<string>(persisted.sentEventIds);
  let sequence = persisted.sequence;

  let stopped = false;
  let ticking = false;

  async function saveState(): Promise<void> {
    persisted = {
      watchlist: [...watching],
      cursor: eventCursor,
      pendingDeliveries,
      sentEventIds: [...sentEventIds],
      sequence,
    };
    await store.save(persisted);
  }

  async function markDelivered(event: SignedGatewayEvent): Promise<void> {
    sentEventIds.add(event.eventId);
    pendingDeliveries = pendingDeliveries.filter((delivery) => delivery.eventId !== event.eventId);
    if (event.eventType === "channel.terminated") {
      watching.delete(event.paycardId);
    }
    await saveState();
  }

  async function enqueueAndDispatch(event: SignedGatewayEvent): Promise<boolean> {
    if (sentEventIds.has(event.eventId)) {
      if (event.eventType === "channel.terminated") {
        watching.delete(event.paycardId);
        await saveState();
      }
      return true;
    }

    const delivered = await dispatch(webhookUrl, event);
    if (delivered) {
      await markDelivered(event);
      return true;
    }

    if (!pendingDeliveries.some((delivery) => delivery.eventId === event.eventId)) {
      pendingDeliveries.push({
        eventId: event.eventId,
        webhookUrl,
        payload: event,
        attempts: 1,
        nextAttemptAtMs: Date.now() + nextBackoffMs(1),
      });
      await saveState();
    }
    return false;
  }

  async function retryPendingDeliveries(): Promise<void> {
    const nowMs = Date.now();
    for (const delivery of [...pendingDeliveries]) {
      if (sentEventIds.has(delivery.eventId)) {
        pendingDeliveries = pendingDeliveries.filter((item) => item.eventId !== delivery.eventId);
        continue;
      }
      if (delivery.nextAttemptAtMs > nowMs) continue;

      const delivered = await dispatch(delivery.webhookUrl, delivery.payload);
      if (delivered) {
        await markDelivered(delivery.payload);
      } else {
        pendingDeliveries = pendingDeliveries.map((item) => item.eventId === delivery.eventId
          ? {
              ...item,
              attempts: item.attempts + 1,
              nextAttemptAtMs: nowMs + nextBackoffMs(item.attempts + 1),
            }
          : item);
        await saveState();
      }
    }
  }

  async function tick(): Promise<void> {
    if (stopped || ticking) return;
    if (watching.size === 0 && pendingDeliveries.length === 0) return;
    ticking = true;

    try {
      const nowSec = Math.floor(Date.now() / 1000);

      try {
        await retryPendingDeliveries();

        const eventsPage = await client.queryEvents({
          query: {
            MoveEventType: `${packageId}::events::SettlementReceipt`,
          },
          cursor: eventCursor ?? undefined,
          limit: 50,
        });

        for (const ev of eventsPage.data) {
          eventCursor = ev.id;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parsed = ev.parsedJson as Record<string, any> | undefined;
          if (!parsed) continue;
          const paycardId = normalizeMoveId(parsed["paycard_id"]);
          if (paycardId && watching.has(paycardId)) {
            const terminalInput: GatewayTerminalEventInput = {
              eventId: `channel.terminated:${ev.id.txDigest}:${ev.id.eventSeq}`,
              paycardId,
              settlementType: Number(parsed["settlement_type"]),
              totalPaidToRecipient: String(parsed["total_paid_to_recipient"]),
              residualReturnedToPayer: String(parsed["residual_returned_to_payer"]),
              closedAtSeconds: Number(parsed["closed_at_seconds"]),
              transactionDigest: ev.id.txDigest,
            };
            if (parsed["initial_allocation"] !== undefined) terminalInput.initialAllocation = String(parsed["initial_allocation"]);
            if (parsed["max_flow_rate_per_second"] !== undefined) terminalInput.maxFlowRatePerSecond = String(parsed["max_flow_rate_per_second"]);
            if (parsed["start_timestamp"] !== undefined) terminalInput.startTimestamp = Number(parsed["start_timestamp"]);
            if (parsed["duration_seconds"] !== undefined) terminalInput.durationSeconds = Number(parsed["duration_seconds"]);
            if (parsed["residual_delta_amount"] !== undefined) terminalInput.residualDeltaAmount = String(parsed["residual_delta_amount"]);
            const residualDeltaRecipient = normalizeMoveId(parsed["residual_delta_recipient"]);
            if (residualDeltaRecipient) terminalInput.residualDeltaRecipient = residualDeltaRecipient;

            const terminalEvent = await buildTerminalEvent(terminalInput, nowSec, ++sequence, signerKeypair);
            await enqueueAndDispatch(terminalEvent);
          }
        }
        await saveState();
      } catch {
        // RPC or persistence error, skip event check this tick.
      }

      for (const paycardId of [...watching]) {
        if (!watching.has(paycardId)) continue;

        // 2. Fetch object and project accrual
        try {
          const obj = await client.getObject({
            id: paycardId,
            options: { showContent: true },
          });

          const content = obj.data?.content;
          if (!content || content.dataType !== "moveObject") continue;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fields = (content as any).fields as Record<string, any>;
          const state = hydrateStreamState(paycardId, fields);

          // 3. Build signed heartbeat
          const heartbeat = await buildHeartbeat(state, nowSec, signerKeypair, ++sequence);

          // 4. Dispatch
          await enqueueAndDispatch(heartbeat);

          if (
            bufferLowThreshold !== undefined &&
            BigInt(heartbeat.projectedBalance) <= bufferLowThreshold
          ) {
            const bufferLowEvent = await buildBufferLowEvent(
              paycardId,
              BigInt(heartbeat.projectedBalance),
              bufferLowThreshold,
              nowSec,
              ++sequence,
              signerKeypair
            );
            await enqueueAndDispatch(bufferLowEvent);
          }
        } catch {
          // Object fetch or persistence error, skip this Paycard this tick
        }
      }

      await saveState();

      if (watching.size === 0 && pendingDeliveries.length === 0) {
        stopped = true;
      }
    } catch {
      // Keep the gateway scheduler alive after unexpected persistence or dispatch failures.
    } finally {
      ticking = false;
    }
  }

  // Kick off the first tick immediately, then on interval
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);

  return {
    publicKeyHex,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
