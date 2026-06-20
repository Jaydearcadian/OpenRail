#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NETWORKS,
  SuiClient,
  getSettlementReceiptByPaycardId,
} from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const manifestPath = resolve(process.env.SHOWCASE_MANIFEST ?? `${repoRoot}/scripts/openrails-v1-1-showcase.manifest.json`);

if (!existsSync(manifestPath)) {
  throw new Error(`Showcase manifest not found at ${manifestPath}.`);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const packageId = process.env.PACKAGE_ID ?? manifest.packageId;
if (!packageId || !/^0x[0-9a-fA-F]+$/.test(packageId)) {
  throw new Error("PACKAGE_ID is missing from env and manifest.");
}

const client = new SuiClient({ url: process.env.SUI_RPC_URL ?? NETWORKS.testnet.rpc });
const terminalKeys = ["depletedFlow", "expiredFlow", "cancelledFlow"];
const activeKeys = ["liveRailsCard", "liveRailsFlow"];
let failures = 0;

function check(label, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`${mark} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
}

function receiptConservesValue(receipt) {
  if (
    receipt.initialAllocation === undefined ||
    receipt.maxFlowRatePerSecond === undefined ||
    receipt.startTimestamp === undefined ||
    receipt.durationSeconds === undefined ||
    receipt.residualDeltaAmount === undefined ||
    receipt.residualDeltaRecipient === undefined
  ) {
    return false;
  }
  return BigInt(receipt.totalPaidToRecipient) + BigInt(receipt.residualReturnedToPayer) === BigInt(receipt.initialAllocation);
}

function normalizePoolValue(value) {
  if (value && typeof value === "object") return value.fields?.value ?? value.value ?? "0";
  return String(value ?? "0");
}

function activeProjection(fields) {
  const status = Number(fields.status);
  const poolBalance = BigInt(normalizePoolValue(fields.allocation_pool));
  const rate = BigInt(fields.max_flow_rate_per_second);
  const start = Number(fields.start_timestamp);
  const duration = Number(fields.duration_seconds);
  const now = Math.floor(Date.now() / 1000);
  const elapsed = Math.max(0, Math.min(now - start, duration));
  const accrued = BigInt(elapsed) * rate;
  const remaining = accrued >= poolBalance ? 0n : poolBalance - accrued;
  return { status, remaining };
}

for (const key of activeKeys) {
  const flow = manifest.flows?.[key];
  check(`${key} paycard recorded`, Boolean(flow?.paycardId), flow?.paycardId ?? "missing");
  if (!flow?.paycardId) continue;
  const object = await client.getObject({ id: flow.paycardId, options: { showContent: true } });
  check(`${key} paycard exists on testnet`, Boolean(object.data?.objectId), object.error?.code ?? object.data?.objectId);
  const fields = object.data?.content?.dataType === "moveObject" ? object.data.content.fields : null;
  if (fields) {
    const projection = activeProjection(fields);
    check(`${key} paycard status active`, projection.status === 0, `status=${projection.status}`);
    check(`${key} paycard not exhausted`, projection.remaining > 0n, `remaining=${projection.remaining}`);
  }
}

for (const key of terminalKeys) {
  const flow = manifest.flows?.[key];
  check(`${key} paycard recorded`, Boolean(flow?.paycardId), flow?.paycardId ?? "missing");
  if (!flow?.paycardId) continue;

  const receipt = await getSettlementReceiptByPaycardId({
    client,
    packageId,
    paycardId: flow.paycardId,
    limit: 50,
    maxPages: 20,
  });

  check(`${key} terminal receipt indexed`, Boolean(receipt), receipt?.transactionDigest ?? "missing");
  if (receipt) {
    check(`${key} value conservation`, receiptConservesValue(receipt), `${receipt.totalPaidToRecipient} + ${receipt.residualReturnedToPayer}`);
  }
}

check("manifest has explorer transactions", Array.isArray(manifest.transactions) && manifest.transactions.length > 0, `${manifest.transactions?.length ?? 0} txs`);

if (failures > 0) {
  console.error(`\nOpenRails V1.1 showcase verification failed: ${failures} issue(s).`);
  process.exit(1);
}

console.log("\nOpenRails V1.1 showcase verification passed.");
