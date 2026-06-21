import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const require = createRequire(import.meta.url);
const ac = require("../dist/access-credential.js");

const kp = new Ed25519Keypair();
const payer = kp.toSuiAddress();

function claims(overrides = {}) {
  return {
    schemaVersion: "1.0",
    paycardId: "0x" + "1".repeat(64),
    payer,
    service: "api.example",
    metadataHash: "0xabababababababababababababababababababababababababababababababab",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    nonce: 1,
    ...overrides,
  };
}

const ACTIVE = async () => ({ active: true });

test("issue → verifySignature roundtrip; payer derives from signer", async () => {
  const cred = await ac.issueAccessCredential(claims(), kp);
  assert.equal(await ac.verifyAccessCredentialSignature(cred), true);
  assert.equal(ac.pubkeyToSuiAddress(cred.curve, cred.signerPublicKey), payer);
});

test("tampered claims fail signature verification", async () => {
  const cred = await ac.issueAccessCredential(claims(), kp);
  cred.claims.service = "evil.example";
  assert.equal(await ac.verifyAccessCredentialSignature(cred), false);
});

test("encode/parse + Authorization header roundtrip", async () => {
  const cred = await ac.issueAccessCredential(claims(), kp);
  const token = ac.encodeAccessCredential(cred);
  assert.deepEqual(ac.parseAccessCredential(token), cred);

  const header = ac.buildAuthorizationHeader(cred);
  assert.match(header, /^OpenRails /);
  assert.deepEqual(ac.parseAuthorizationHeader(header), cred);
  assert.equal(ac.parseAuthorizationHeader("Bearer xyz"), null);
  assert.equal(ac.parseAuthorizationHeader(null), null);
});

test("full verify grants on an active channel, denies on settled/inactive", async () => {
  const cred = await ac.issueAccessCredential(claims(), kp);
  assert.deepEqual(await ac.verifyAccessCredential({ credential: cred, resolveChannel: ACTIVE }), {
    granted: true,
    reason: "ok",
    paycardId: cred.claims.paycardId,
  });

  const settled = await ac.verifyAccessCredential({ credential: cred, resolveChannel: async () => ({ active: false, settled: true }) });
  assert.equal(settled.reason, "channel_settled");
  assert.equal(settled.granted, false);

  const inactive = await ac.verifyAccessCredential({ credential: cred, resolveChannel: async () => ({ active: false }) });
  assert.equal(inactive.reason, "channel_inactive");
});

test("expired and wrong-payer credentials are denied", async () => {
  const expired = await ac.issueAccessCredential(claims({ expiresAt: new Date(Date.now() - 1000).toISOString() }), kp);
  assert.equal((await ac.verifyAccessCredential({ credential: expired, resolveChannel: ACTIVE })).reason, "expired");

  const wrong = await ac.issueAccessCredential(claims({ payer: "0x" + "9".repeat(64) }), kp);
  assert.equal((await ac.verifyAccessCredential({ credential: wrong, resolveChannel: ACTIVE })).reason, "payer_mismatch");
});

test("optional merchant co-signature verifies", async () => {
  const merchantKp = new Ed25519Keypair();
  const cred = await ac.issueAccessCredential(claims(), kp, "ed25519", { signer: merchantKp });
  assert.ok(cred.merchant);
  assert.equal(await ac.verifyAccessCredentialSignature(cred), true);
  cred.merchant.signature = "00".repeat(64);
  assert.equal(await ac.verifyAccessCredentialSignature(cred), false);
});
