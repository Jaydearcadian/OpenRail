#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Ed25519Keypair,
  SuiClient,
  decodeSuiPrivateKey,
  NETWORKS,
  COIN_TYPES,
  START_DYNAMIC,
  buildCancelPTB,
  buildClaimPTB,
  buildCreateVaultPTB,
  buildMintPTB,
  buildResolvePTB,
  buildUnsealVaultPTB,
  signVaultEd25519,
} from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const manifestPath = resolve(process.env.SHOWCASE_MANIFEST ?? `${repoRoot}/scripts/openrails-v1-1-showcase.manifest.json`);
const TX_OPTIONS = { showObjectChanges: true, showEvents: true, showEffects: true };

const packageId = requiredObjectId("PACKAGE_ID");
const payer = keypairFromEnv("PAYER_PRIVATE_KEY");
const recipient = keypairFromEnv("RECIPIENT_PRIVATE_KEY");
const merchant = keypairFromEnv("MERCHANT_PRIVATE_KEY");

const payerAddress = payer.getPublicKey().toSuiAddress();
const recipientAddress = recipient.getPublicKey().toSuiAddress();
const merchantAddress = merchant.getPublicKey().toSuiAddress();
const payerPubkeyHex = bytesToHex(payer.getPublicKey().toRawBytes());

const client = new SuiClient({ url: process.env.SUI_RPC_URL ?? NETWORKS.testnet.rpc });
const coinIds = {
  railsCardAllocation: requiredObjectId("RAILSCARD_COIN_OBJECT_ID"),
  railsCardGas: requiredObjectId("RAILSCARD_GAS_COIN_OBJECT_ID"),
  liveFlow: requiredObjectId("LIVE_FLOW_COIN_OBJECT_ID"),
  depleted: requiredObjectId("DEPLETED_COIN_OBJECT_ID"),
  expired: requiredObjectId("EXPIRED_COIN_OBJECT_ID"),
  cancelled: requiredObjectId("CANCELLED_COIN_OBJECT_ID"),
};
const showcaseGasObjectId = process.env.SHOWCASE_GAS_OBJECT_ID;
const refreshActive = process.env.SHOWCASE_REFRESH_ACTIVE === "1";
const refreshFlow = process.env.SHOWCASE_REFRESH_FLOW;

function requiredObjectId(name) {
  const value = process.env[name];
  if (!value || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`Set ${name}=0x... before running the V1.1 showcase seeder.`);
  }
  return value;
}

function keypairFromEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}=<Sui exportedPrivateKey>. Value will not be printed.`);
  const parsed = decodeSuiPrivateKey(value);
  if (parsed.scheme !== "ED25519") throw new Error(`${name} must be an Ed25519 Sui private key.`);
  return Ed25519Keypair.fromSecretKey(parsed.secretKey);
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function explorerUrl(digest) {
  return `https://suiexplorer.com/txblock/${digest}?network=testnet`;
}

async function loadManifest() {
  if (!existsSync(manifestPath)) {
    return {
      schemaVersion: "1",
      kind: "openrails.v1_1.showcase",
      network: "testnet",
      packageId,
      createdAt: new Date().toISOString(),
      operators: {
        payer: payerAddress,
        recipient: recipientAddress,
        merchant: merchantAddress,
      },
      flows: {},
      transactions: [],
    };
  }
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

async function saveManifest(manifest) {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function requireSuccess(result, label) {
  const status = result.effects?.status?.status;
  if (status !== "success") {
    throw new Error(`${label} failed: ${result.effects?.status?.error ?? "unknown Sui execution error"}`);
  }
}

function findCreatedObject(result, typeNeedle) {
  return result.objectChanges?.find((change) =>
    change.type === "created" &&
    typeof change.objectType === "string" &&
    change.objectType.includes(typeNeedle)
  )?.objectId;
}

function normalizeMoveId(value) {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && typeof value.id === "string") return value.id;
  return null;
}

function findReceiptEvent(result, paycardId) {
  return result.events?.find((event) =>
    event.type.endsWith("::events::SettlementReceipt") &&
    normalizeMoveId(event.parsedJson?.paycard_id) === paycardId
  );
}

async function execute(label, signer, tx, manifest) {
  await applyGasPayment(tx);
  const submitted = await client.signAndExecuteTransaction({ signer, transaction: tx, options: TX_OPTIONS });
  const result = await client.waitForTransaction({ digest: submitted.digest, options: TX_OPTIONS });
  requireSuccess(result, label);
  manifest.transactions.push({
    label,
    digest: result.digest,
    explorerUrl: explorerUrl(result.digest),
    timestamp: new Date().toISOString(),
  });
  await saveManifest(manifest);
  console.log(`${label}: ${result.digest}`);
  return result;
}

async function applyGasPayment(tx) {
  if (!showcaseGasObjectId) return;
  const gasObject = await client.getObject({ id: showcaseGasObjectId });
  if (!gasObject.data?.objectId || !gasObject.data.version || !gasObject.data.digest) {
    throw new Error(`SHOWCASE_GAS_OBJECT_ID ${showcaseGasObjectId} is not available as a gas object.`);
  }
  tx.setGasPayment([{
    objectId: gasObject.data.objectId,
    version: gasObject.data.version,
    digest: gasObject.data.digest,
  }]);
  tx.setGasBudget(20_000_000);
}

async function seedDirectFlow(manifest, key, signer, recipientAddressForFlow, coinObjectId, params) {
  if (manifest.flows[key]?.paycardId && !(refreshActive && key === "liveRailsFlow") && refreshFlow !== key) return manifest.flows[key];

  const tx = buildMintPTB({
    packageId,
    coinObjectId,
    totalProvisionAmount: params.allocation,
    maxFlowRatePerSecond: params.rate,
    recipient: recipientAddressForFlow,
    startTimestamp: params.startTimestamp,
    durationSeconds: params.durationSeconds,
    recoveryTarget: payerAddress,
    typeArgument: COIN_TYPES.SUI,
  });
  const result = await execute(`${key}: mint channel`, signer, tx, manifest);
  const paycardId = findCreatedObject(result, "Paycard");
  if (!paycardId) throw new Error(`${key}: minted Paycard object not found in object changes.`);

  manifest.flows[key] = {
    kind: "railsflow",
    paycardId,
    recipient: recipientAddressForFlow,
    allocation: params.allocation.toString(),
    rate: params.rate.toString(),
    startTimestamp: params.startTimestamp,
    durationSeconds: params.durationSeconds,
    state: "active",
  };
  await saveManifest(manifest);
  return manifest.flows[key];
}

async function settleClaim(manifest, key, signer, settlementLabel) {
  const flow = manifest.flows[key];
  if (flow.receipt) return flow;
  const result = await execute(`${key}: ${settlementLabel}`, signer, buildClaimPTB({
    packageId,
    paycardObjectId: flow.paycardId,
    typeArgument: COIN_TYPES.SUI,
  }), manifest);
  const receipt = findReceiptEvent(result, flow.paycardId);
  if (receipt) {
    flow.receipt = receipt.parsedJson;
    flow.receiptEventId = receipt.id;
    flow.state = "settled";
    await saveManifest(manifest);
  }
  return flow;
}

async function settleResolve(manifest, key) {
  const flow = manifest.flows[key];
  if (flow.receipt) return flow;
  const result = await execute(`${key}: resolve STN-Delta expiry`, payer, buildResolvePTB({
    packageId,
    paycardObjectId: flow.paycardId,
    typeArgument: COIN_TYPES.SUI,
  }), manifest);
  const receipt = findReceiptEvent(result, flow.paycardId);
  if (!receipt) throw new Error(`${key}: expected SettlementReceipt in expiry resolve transaction.`);
  flow.receipt = receipt.parsedJson;
  flow.receiptEventId = receipt.id;
  flow.state = "settled";
  await saveManifest(manifest);
  return flow;
}

async function settleCancel(manifest, key) {
  const flow = manifest.flows[key];
  if (flow.receipt) return flow;
  const result = await execute(`${key}: cancel channel`, payer, buildCancelPTB({
    packageId,
    paycardObjectId: flow.paycardId,
    typeArgument: COIN_TYPES.SUI,
  }), manifest);
  const receipt = findReceiptEvent(result, flow.paycardId);
  if (!receipt) throw new Error(`${key}: expected SettlementReceipt in cancellation transaction.`);
  flow.receipt = receipt.parsedJson;
  flow.receiptEventId = receipt.id;
  flow.state = "settled";
  await saveManifest(manifest);
  return flow;
}

async function seedRailsCard(manifest, now) {
  if (manifest.flows.liveRailsCard?.paycardId && !refreshActive && refreshFlow !== "liveRailsCard") return manifest.flows.liveRailsCard;

  const allocation = 15_000_000n;
  const gasReserve = 3_000_000n;
  const rate = 10n;
  const durationSeconds = 604_800;
  const nonce = BigInt(Date.now());

  const vaultTx = buildCreateVaultPTB({
    packageId,
    coinObjectId: coinIds.railsCardAllocation,
    allocationAmount: allocation,
    gasCoinObjectId: coinIds.railsCardGas,
    gasAmount: gasReserve,
    payerPubkeyHex,
    maxFlowRatePerSecond: rate,
    durationSeconds,
    startTimestamp: START_DYNAMIC,
    recoveryTarget: payerAddress,
    nonce,
    curve: 0,
    typeArgument: COIN_TYPES.SUI,
  });
  const vaultResult = await execute("liveRailsCard: create sealed vault", payer, vaultTx, manifest);
  const vaultObjectId = findCreatedObject(vaultResult, "SealedVault");
  if (!vaultObjectId) throw new Error("liveRailsCard: SealedVault object not found in object changes.");

  const signature = await signVaultEd25519({
    payerPubkey: payer.getPublicKey().toRawBytes(),
    allocationAmount: allocation,
    gasAmount: gasReserve,
    maxFlowRatePerSecond: rate,
    durationSeconds,
    startTimestamp: START_DYNAMIC,
    recoveryTarget: payerAddress,
    nonce,
    curve: 0,
  }, payer);

  const unsealResult = await execute("liveRailsCard: unseal to channel", recipient, buildUnsealVaultPTB({
    packageId,
    vaultObjectId,
    signature,
    recipient: recipientAddress,
    typeArgument: COIN_TYPES.SUI,
  }), manifest);
  const paycardId = findCreatedObject(unsealResult, "Paycard");
  if (!paycardId) throw new Error("liveRailsCard: Paycard object not found in object changes.");

  manifest.flows.liveRailsCard = {
    kind: "railscard",
    vaultObjectId,
    paycardId,
    recipient: recipientAddress,
    allocation: allocation.toString(),
    rate: rate.toString(),
    startTimestamp: now,
    durationSeconds,
    state: "active",
  };
  await saveManifest(manifest);
  return manifest.flows.liveRailsCard;
}

async function main() {
  const manifest = await loadManifest();
  const now = Math.floor(Date.now() / 1000);

  await seedRailsCard(manifest, now);

  await seedDirectFlow(manifest, "liveRailsFlow", payer, merchantAddress, coinIds.liveFlow, {
    allocation: 15_000_000n,
    rate: 10n,
    startTimestamp: now,
    durationSeconds: 604_800,
  });

  await seedDirectFlow(manifest, "depletedFlow", payer, merchantAddress, coinIds.depleted, {
    allocation: 500_000n,
    rate: 500_000n,
    startTimestamp: now - 2,
    durationSeconds: 600,
  });
  await settleClaim(manifest, "depletedFlow", merchant, "claim to depletion");

  await seedDirectFlow(manifest, "expiredFlow", payer, merchantAddress, coinIds.expired, {
    allocation: 2_000_000n,
    rate: 1_000_000n,
    startTimestamp: now - 3,
    durationSeconds: 1,
  });
  await settleResolve(manifest, "expiredFlow");

  await seedDirectFlow(manifest, "cancelledFlow", payer, recipientAddress, coinIds.cancelled, {
    allocation: 8_000_000n,
    rate: 1_000_000n,
    startTimestamp: now - 2,
    durationSeconds: 600,
  });
  await settleCancel(manifest, "cancelledFlow");

  manifest.completedAt = new Date().toISOString();
  await saveManifest(manifest);
  console.log(`\nOpenRails V1.1 showcase manifest written to ${manifestPath}`);
  console.log("Public paycards:", Object.values(manifest.flows).map((flow) => flow.paycardId).join(", "));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
