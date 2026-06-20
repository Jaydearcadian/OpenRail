import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildVaultMessage } = require("../dist/vault.js");

const baseParams = {
  payerPubkey: new Uint8Array(32).fill(2),
  allocationAmount: 1000n,
  gasAmount: 50n,
  maxFlowRatePerSecond: 100n,
  durationSeconds: 3600,
  startTimestamp: 0,
  recoveryTarget: "0x" + "11".repeat(32),
  nonce: 7n,
  curve: 0,
  nonceChannel: 5n,
  metadataHash: new Uint8Array(0),
};

// Layout: pubkey(32) + alloc(8)+gas(8)+rate(8)+duration(8)+start(8)+recovery(32)
//         + nonce(8) + curve(1) + nonce_channel(8) + metadata_hash(len)
const HEAD_LEN = 32 + 8 + 8 + 8 + 8 + 8 + 32 + 8 + 1; // 113
const CHANNEL_OFFSET = HEAD_LEN; // 113

test("vault message appends nonce_channel + empty metadata_hash (V1.2)", () => {
  const msg = buildVaultMessage(baseParams);
  assert.equal(msg.length, HEAD_LEN + 8 + 0); // 121
  // nonce_channel = 5 as little-endian u64
  assert.deepEqual(Array.from(msg.slice(CHANNEL_OFFSET, CHANNEL_OFFSET + 8)), [5, 0, 0, 0, 0, 0, 0, 0]);
});

test("vault message carries a 32-byte metadata_hash at the tail", () => {
  const metadataHash = new Uint8Array(32).fill(0xab);
  const msg = buildVaultMessage({ ...baseParams, metadataHash });
  assert.equal(msg.length, HEAD_LEN + 8 + 32); // 153
  assert.deepEqual(Array.from(msg.slice(-32)), Array.from(metadataHash));
});
