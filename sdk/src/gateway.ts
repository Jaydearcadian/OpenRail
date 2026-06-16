import { SuiClient } from "@mysten/sui/client";
import type { EventId } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { StreamState } from "./accrual.js";
import { buildBufferLowEvent, buildHeartbeat, buildTerminalEvent } from "./heartbeat.js";

export interface GatewayConfig {
  suiRpcUrl: string;
  packageId: string;
  paycardIds: string[];
  webhookUrl: string;
  intervalMs?: number;           // Default: 10_000ms
  bufferLowThreshold?: bigint | string;
  signerKeypair: Ed25519Keypair;
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
    status:                   status === 0 ? "active" : "depleted",
  };
}

// --- Webhook dispatch ---

async function dispatch(webhookUrl: string, payload: unknown, attempts = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
 * the gateway emits a final heartbeat (isExhausted=true) and removes
 * that Paycard from the watch list. When all Paycards are settled,
 * the gateway stops automatically.
 */
export async function startGateway(config: GatewayConfig): Promise<GatewayHandle> {
  const { suiRpcUrl, packageId, webhookUrl, signerKeypair } = config;
  const intervalMs = config.intervalMs ?? 10_000;
  const bufferLowThreshold = config.bufferLowThreshold === undefined
    ? undefined
    : BigInt(config.bufferLowThreshold);

  const client = new SuiClient({ url: suiRpcUrl });
  const publicKeyHex = Buffer.from(signerKeypair.getPublicKey().toRawBytes()).toString("hex");

  // Mutable watch list — paycards are removed when they reach terminal state
  const watching = new Set<string>(config.paycardIds);

  let eventCursor: EventId | null = null;
  let sequence = 0;

  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped || watching.size === 0) return;

    const nowSec = Math.floor(Date.now() / 1000);

    try {
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
        const paycardId = parsed["paycard_id"];
        if (typeof paycardId === "string" && watching.has(paycardId)) {
          const terminalEvent = await buildTerminalEvent({
            paycardId,
            settlementType: Number(parsed["settlement_type"]),
            totalPaidToRecipient: String(parsed["total_paid_to_recipient"]),
            residualReturnedToPayer: String(parsed["residual_returned_to_payer"]),
            closedAtSeconds: Number(parsed["closed_at_seconds"]),
          }, nowSec, ++sequence, signerKeypair);
          await dispatch(webhookUrl, terminalEvent);
          watching.delete(paycardId);
        }
      }
    } catch {
      // RPC error, skip event check this tick.
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
        await dispatch(webhookUrl, heartbeat);

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
          await dispatch(webhookUrl, bufferLowEvent);
        }

        if (state.status === "depleted") {
          watching.delete(paycardId);
        }
      } catch {
        // Object fetch error — skip this Paycard this tick
      }
    }

    if (watching.size === 0) {
      stopped = true;
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
