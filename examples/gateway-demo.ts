/**
 * Gateway Demo — Dynamic Stream Event Gateway (round-trip)
 *
 * This demo runs entirely offline — no live Paycard or Sui RPC needed.
 *
 * Flow:
 *   1. Spin up a local HTTP server acting as the merchant's webhook receiver
 *   2. Construct a mock StreamState representing an active Paycard
 *   3. Start the gateway pointed at the local server using a generated keypair
 *   4. Merchant receiver verifies each heartbeat signature and logs the payload
 *   5. Gracefully stop after 3 verified heartbeats
 */

import * as http from "http";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  calculateAccrualDebt,
  projectStreamAt,
  buildHeartbeat,
  verifyHeartbeat,
} from "../sdk/src/index.js";
import type { StreamState, StreamHeartbeat } from "../sdk/src/index.js";

// --- Mock stream configuration ---

const NOW_SEC = Math.floor(Date.now() / 1000);

const MOCK_STATE: StreamState = {
  paycardId:                "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  poolBalance:              10_000n,        // 10 000 token units
  initialAllocation:        10_000n,
  maxFlowRatePerSecond:     100n,           // 100 units/second
  startTimestamp:           NOW_SEC - 30,   // started 30 seconds ago
  durationSeconds:          100,
  lastCheckpointTimestamp:  NOW_SEC - 30,
  status:                   "active",
};

// --- Gateway keypair ---

const gatewayKeypair = Ed25519Keypair.generate();
const gatewayPublicKeyHex = Buffer.from(
  gatewayKeypair.getPublicKey().toRawBytes()
).toString("hex");

console.log("[GATEWAY] Public key:", gatewayPublicKeyHex);

// --- Merchant receiver ---

const PORT = 9876;
let heartbeatCount = 0;
let serverResolve: () => void;
const serverDone = new Promise<void>((res) => { serverResolve = res; });

const server = http.createServer((req, res) => {
  if (req.method !== "POST") { res.end(); return; }

  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  req.on("end", async () => {
    let heartbeat: StreamHeartbeat;
    try {
      heartbeat = JSON.parse(body) as StreamHeartbeat;
    } catch {
      console.log("[MERCHANT] Invalid JSON received");
      res.end();
      return;
    }

    const valid = await verifyHeartbeat(heartbeat, gatewayPublicKeyHex);
    heartbeatCount++;

    console.log(`[MERCHANT] Heartbeat #${heartbeatCount}`);
    console.log(`           paycardId:              ${heartbeat.paycardId}`);
    console.log(`           accruedSinceCheckpoint: ${heartbeat.accruedSinceCheckpoint}`);
    console.log(`           projectedBalance:       ${heartbeat.projectedBalance}`);
    console.log(`           isExhausted:            ${heartbeat.isExhausted}`);
    console.log(`           signature valid:        ${valid}`);

    res.writeHead(200);
    res.end();

    if (heartbeatCount >= 3) {
      console.log("\n[MERCHANT] 3 heartbeats received — shutting down.");
      serverResolve();
    }
  });
});

// --- Offline gateway (no RPC — drives heartbeats directly for the demo) ---

async function runOfflineGateway(
  state: StreamState,
  webhookUrl: string,
  keypair: Ed25519Keypair,
  count: number,
  intervalMs: number
): Promise<void> {
  let fired = 0;

  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const heartbeat = await buildHeartbeat(state, nowSec, keypair);

      const { accrued, remaining } = projectStreamAt(state, nowSec);
      console.log(
        `[GATEWAY]  tick — accrued=${accrued}, remaining=${remaining}, isExhausted=${heartbeat.isExhausted}`
      );

      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(heartbeat),
        });
      } catch (e) {
        console.error("[GATEWAY]  dispatch error:", e);
      }

      fired++;
      if (fired >= count) {
        clearInterval(timer);
        resolve();
      }
    }, intervalMs);
  });
}

// --- Verification sanity check (offline, before server starts) ---

console.log("\n[DEMO] Accrual sanity check (30s elapsed, rate=100/s):");
const debt = calculateAccrualDebt(MOCK_STATE, NOW_SEC);
console.log(`       accrued since checkpoint: ${debt} units (expected 3000)`);
const projection = projectStreamAt(MOCK_STATE, NOW_SEC);
console.log(`       projected balance:        ${projection.remaining} units (expected 7000)\n`);

// --- Run ---

server.listen(PORT, async () => {
  console.log(`[MERCHANT] Webhook receiver listening on http://localhost:${PORT}\n`);

  await runOfflineGateway(
    MOCK_STATE,
    `http://localhost:${PORT}`,
    gatewayKeypair,
    3,
    1_500   // 1.5 second intervals for a quick demo
  );

  await serverDone;
  server.close();
  console.log("\n[DEMO] Complete.");
});
