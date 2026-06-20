#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Ed25519Keypair,
  decodeSuiPrivateKey,
  NETWORKS,
  startGateway,
} from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const manifestPath = resolve(process.env.SHOWCASE_MANIFEST ?? `${repoRoot}/scripts/openrails-v1-1-showcase.manifest.json`);
const webhookUrl = process.env.GATEWAY_WEBHOOK_URL;
const privateKey = process.env.GATEWAY_PRIVATE_KEY;
const packageId = process.env.PACKAGE_ID;
const storePath = resolve(process.env.GATEWAY_STORE_PATH ?? `${repoRoot}/scripts/openrails-v1-1-gateway-state.json`);

if (!packageId || !/^0x[0-9a-fA-F]+$/.test(packageId)) {
  throw new Error("Set PACKAGE_ID=0x... before starting the gateway operator.");
}
if (!webhookUrl || !/^https?:\/\//.test(webhookUrl)) {
  throw new Error("Set GATEWAY_WEBHOOK_URL=https://... before starting the gateway operator.");
}
if (!privateKey) {
  throw new Error("Set GATEWAY_PRIVATE_KEY=<Sui exportedPrivateKey>. Value will not be printed.");
}
if (!existsSync(manifestPath)) {
  throw new Error(`Showcase manifest not found at ${manifestPath}. Run seed-testnet-showcase first.`);
}

const parsedKey = decodeSuiPrivateKey(privateKey);
if (parsedKey.scheme !== "ED25519") {
  throw new Error("GATEWAY_PRIVATE_KEY must be an Ed25519 Sui private key.");
}
const signerKeypair = Ed25519Keypair.fromSecretKey(parsedKey.secretKey);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const paycardIds = Object.values(manifest.flows ?? {})
  .filter((flow) => flow?.paycardId && flow.state === "active")
  .map((flow) => flow.paycardId);

if (paycardIds.length === 0) {
  throw new Error("Manifest has no active paycards to watch.");
}

const handle = await startGateway({
  suiRpcUrl: process.env.SUI_RPC_URL ?? NETWORKS.testnet.rpc,
  packageId,
  paycardIds,
  webhookUrl,
  intervalMs: Number(process.env.GATEWAY_INTERVAL_MS ?? 10_000),
  bufferLowThreshold: process.env.GATEWAY_BUFFER_LOW_THRESHOLD,
  signerKeypair,
  storePath,
});

console.log("OpenRails V1.1 gateway operator started.");
console.log("Watched paycards:", paycardIds.join(", "));
console.log("Gateway public key:", handle.publicKeyHex);
console.log("Store path:", storePath);

function stop() {
  handle.stop();
  console.log("OpenRails gateway operator stopped.");
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
