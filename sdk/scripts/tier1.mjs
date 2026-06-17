import {
  calculateAccrualDebt,
  projectStreamAt,
  OpenRailsSDK,
  buildShortLink,
  NETWORKS,
  COIN_TYPES,
  WALRUS_ENDPOINTS,
  signEnvelopeEd25519,
  bindRailsFlowMerchant,
  verifyRailsFlowMerchantEnvelope,
  verifyEnvelope,
  canonicalJson,
  canonicalEnvelopeBytes,
  encryptOpenRailsLink,
  decryptOpenRailsLink,
  generateEncryptedLinkKey,
  buildEncryptedShortLink,
  parseEncryptedShortLink,
  uploadEncryptedEnvelope,
  fetchEncryptedEnvelope,
  buildHeartbeat,
  verifyGatewayEvent,
  InMemoryGatewayStore,
  FileGatewayStore,
  startGateway,
  walrusBlobIdToBytes,
  buildMintPTB,
  buildClaimPTB,
} from '../dist/index.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${name}`);
    failed++;
  }
}

// ── Accrual math ──────────────────────────────────────────────────────────────
console.log('\nAccrual math');

const base = {
  paycardId: '0x1',
  poolBalance: 10_000n,
  initialAllocation: 10_000n,
  maxFlowRatePerSecond: 100n,
  startTimestamp: 1000,
  durationSeconds: 100,
  lastCheckpointTimestamp: 1000,
  status: 'active',
};

// 1
check('depleted status returns 0',
  calculateAccrualDebt({ ...base, status: 'depleted' }, 1050) === 0n
);
// 2
check('currentTime at checkpoint returns 0',
  calculateAccrualDebt(base, 1000) === 0n
);
// 3
check('10s elapsed at 100/s → 1000 accrued',
  calculateAccrualDebt(base, 1010) === 1000n
);
// 4: time past end of stream — capped at durationSeconds boundary (100s * 100 = 10000)
check('past stream end is capped at duration (rate * duration = pool)',
  calculateAccrualDebt(base, 2000) === 10_000n
);
// 5: pool smaller than rate × time — capped at pool balance
check('capped at pool balance when pool < rate×time',
  calculateAccrualDebt({ ...base, poolBalance: 300n }, 1010) === 300n
);
// 6: projectStreamAt exhaustion
const proj = projectStreamAt({ ...base, poolBalance: 500n }, 1005);
check('projectStreamAt: exhausted when accrued == pool',
  proj.isExhausted === true && proj.accrued === 500n && proj.remaining === 0n
);

// ── Envelope serialization ────────────────────────────────────────────────────
console.log('\nEnvelope serialization');

const testPayload = {
  linkType: 'railscard',
  vaultObjectId: '0xvault',
  vaultSignature: 'ab'.repeat(64),
  envelope: { payerPublicKey: '0xabc', nonce: 1, signature: '0xdef', curve: 'ed25519' },
  intent: {
    paycardId: '0x1',
    asset: { packageId: '0x2', moduleName: 'sui', typeArgument: '0x2::sui::SUI' },
    allocationPoolSize: '1000',
    maxFlowRatePerSecond: '10',
    startTimestamp: 0,
    durationSeconds: 100,
    residualDeltaRecipient: '0xrec',
  },
};

const token = OpenRailsSDK.serializePayload(testPayload);
const decoded = OpenRailsSDK.deserializePayload(token);

// 7
check('token is URL-safe base64 (no = + /)',
  typeof token === 'string' &&
  !token.includes('=') && !token.includes('+') && !token.includes('/')
);
// 8
check('round-trips linkType field',
  decoded.linkType === 'railscard'
);
// 9
check('round-trips intent.allocationPoolSize',
  decoded.intent.allocationPoolSize === '1000'
);
// 10
check('isValidToken rejects garbage input',
  OpenRailsSDK.isValidToken('not-a-valid-token!!') === false
);

// ── Short links ───────────────────────────────────────────────────────────────
console.log('\nShort links');

const BLOB = '0xdeadbeefcafe1234';

// 11
check('buildShortLink: default base URL',
  buildShortLink(BLOB) === `https://rails.to/v1/${BLOB}`
);
// 12
check('buildShortLink: custom base URL',
  buildShortLink(BLOB, 'https://myrelay.example/v1') ===
    `https://myrelay.example/v1/${BLOB}`
);
// 13
check('blobId appears verbatim in short link',
  buildShortLink(BLOB).endsWith(BLOB)
);

// ── Network addresses ─────────────────────────────────────────────────────────
console.log('\nNetwork addresses');

const HEX64 = /^0x[0-9a-f]{64}$/;

// 14
check('testnet deepbookPackageId is confirmed hex address',
  HEX64.test(NETWORKS.testnet.deepbookPackageId)
);
// 15
check('mainnet deepbookPackageId is confirmed hex address',
  HEX64.test(NETWORKS.mainnet.deepbookPackageId)
);
// 16: testnet uses DBUSDC — key name distinct from mainnet suiUsdc
check('testnet suiDbusdc pool is confirmed hex address',
  HEX64.test(NETWORKS.testnet.pools.suiDbusdc)
);
// 17
check('COIN_TYPES.SUI === "0x2::sui::SUI"',
  COIN_TYPES.SUI === '0x2::sui::SUI'
);
// 18
check('WALRUS_ENDPOINTS.testnet.publisher is HTTPS',
  WALRUS_ENDPOINTS.testnet.publisher.startsWith('https://')
);

// ── PTB construction ──────────────────────────────────────────────────────────
console.log('\nPTB construction');

const PKG  = '0x' + '0'.repeat(64);
const COIN = '0x' + '1'.repeat(64);
const ADDR = '0x' + '2'.repeat(64);
const PAYD = '0x' + '3'.repeat(64);

// 19
const mintTx = buildMintPTB({
  packageId: PKG,
  coinObjectId: COIN,
  totalProvisionAmount: 1000n,
  maxFlowRatePerSecond: 10n,
  recipient: ADDR,
  startTimestamp: 0,
  durationSeconds: 100,
  recoveryTarget: ADDR,
  typeArgument: '0x2::sui::SUI',
});
check('buildMintPTB returns Transaction with moveCall',
  mintTx !== null &&
  typeof mintTx === 'object' &&
  typeof mintTx.moveCall === 'function'
);

// 20
const claimTx = buildClaimPTB({
  packageId: PKG,
  paycardObjectId: PAYD,
  typeArgument: '0x2::sui::SUI',
});
check('buildClaimPTB returns Transaction with moveCall',
  claimTx !== null &&
  typeof claimTx === 'object' &&
  typeof claimTx.moveCall === 'function'
);

// ── Ed25519 signing ───────────────────────────────────────────────────────────
console.log('\nEd25519 signing');

const kp = Ed25519Keypair.generate();
const testIntent = {
  paycardId: '0x1',
  asset: { packageId: '0x2', moduleName: 'sui', typeArgument: '0x2::sui::SUI' },
  allocationPoolSize: '1000',
  maxFlowRatePerSecond: '10',
  startTimestamp: 0,
  durationSeconds: 100,
  residualDeltaRecipient: '0xrec',
};

const env = await signEnvelopeEd25519(testIntent, kp);

// 21
check('curve field is "ed25519"',
  env.curve === 'ed25519'
);
// 22
check('signature is non-empty lowercase hex (even length)',
  typeof env.signature === 'string' &&
  env.signature.length > 0 &&
  env.signature.length % 2 === 0 &&
  /^[0-9a-f]+$/.test(env.signature)
);
// 23: Ed25519 public key is 32 bytes → 64 hex chars
check('payerPublicKey is 64 hex chars (32 bytes)',
  typeof env.payerPublicKey === 'string' &&
  env.payerPublicKey.length === 64 &&
  /^[0-9a-f]+$/.test(env.payerPublicKey)
);
// 24
check('nonce is a positive number',
  typeof env.nonce === 'number' && env.nonce > 0
);

// 25
check('canonical JSON recursively sorts keys',
  canonicalJson({ z: 1, a: { y: true, b: ['x', { d: 4, c: 3 }] } }) ===
    '{"a":{"b":["x",{"c":3,"d":4}],"y":true},"z":1}'
);
// 26
check('canonical bytes reject unsupported undefined values',
  (() => {
    try {
      canonicalEnvelopeBytes({ bad: undefined });
      return false;
    } catch {
      return true;
    }
  })()
);

const reorderedIntent = {
  residualDeltaRecipient: '0xrec',
  durationSeconds: 100,
  startTimestamp: 0,
  maxFlowRatePerSecond: '10',
  allocationPoolSize: '1000',
  asset: { typeArgument: '0x2::sui::SUI', moduleName: 'sui', packageId: '0x2' },
  paycardId: '0x1',
};
const canonicalEnvA = await signEnvelopeEd25519(testIntent, kp, 777);
const canonicalEnvB = await signEnvelopeEd25519(reorderedIntent, kp, 777);
// 27
check('canonical signing is deterministic across key order',
  canonicalEnvA.signature === canonicalEnvB.signature
);

const legacyNonce = 778;
const legacyBytes = new TextEncoder().encode(JSON.stringify({ intent: testIntent, nonce: legacyNonce }));
const legacySig = await kp.sign(legacyBytes);
const legacyEnvelope = {
  payerPublicKey: Buffer.from(kp.getPublicKey().toRawBytes()).toString('hex'),
  nonce: legacyNonce,
  signature: Buffer.from(legacySig).toString('hex'),
  curve: 'ed25519',
};
// 28
check('verifyEnvelope accepts legacy JSON signatures',
  await verifyEnvelope(testIntent, legacyEnvelope) === true
);
// 29
check('schema v1 envelope rejects legacy JSON signature fallback',
  await verifyEnvelope(testIntent, { ...legacyEnvelope, schemaVersion: '1' }) === false
);

// ── RailsFlow merchant binding ────────────────────────────────────────────────
console.log('\nRailsFlow merchant binding');

const merchantKp = Ed25519Keypair.generate();
const merchantAddress = merchantKp.getPublicKey().toSuiAddress();
const flowIntent = { ...testIntent, residualDeltaRecipient: '0xpayer' };
const invoiceDescription = 'invoice #42: canonical metadata';
const merchantEnvelope = await signEnvelopeEd25519(
  bindRailsFlowMerchant(flowIntent, merchantAddress, invoiceDescription),
  merchantKp,
  42
);
const flowPayload = {
  linkType: 'railsflow',
  envelope: merchantEnvelope,
  intent: flowIntent,
  merchantAddress,
  invoiceDescription,
};

// 30
check('valid RailsFlow merchant envelope verifies',
  await verifyRailsFlowMerchantEnvelope(flowPayload) === true
);
// 31
check('tampered RailsFlow merchant address fails verification',
  await verifyRailsFlowMerchantEnvelope({
    ...flowPayload,
    merchantAddress: '0x' + '9'.repeat(64),
  }) === false
);
// 32
check('tampered RailsFlow invoice metadata fails verification',
  await verifyRailsFlowMerchantEnvelope({
    ...flowPayload,
    invoiceDescription: 'invoice #42: altered metadata',
  }) === false
);

// ── Gateway event signatures ─────────────────────────────────────────────────
console.log('\nGateway event signatures');

const gatewayKp = Ed25519Keypair.generate();
const gatewayPubkeyHex = Buffer.from(gatewayKp.getPublicKey().toRawBytes()).toString('hex');
const heartbeat = await buildHeartbeat(base, 1010, gatewayKp, 1);

// 33
check('heartbeat includes canonical gateway envelope fields',
  heartbeat.schemaVersion === '1' &&
  heartbeat.eventType === 'stream.accrual_heartbeat' &&
  typeof heartbeat.eventId === 'string' &&
  heartbeat.sequence === 1
);
// 34
check('signed gateway event verifies',
  await verifyGatewayEvent(heartbeat, gatewayPubkeyHex) === true
);
// 35
check('tampered gateway event fails verification',
  await verifyGatewayEvent({ ...heartbeat, projectedBalance: '0' }, gatewayPubkeyHex) === false
);
// 36
check('tampered gateway eventId fails verification',
  await verifyGatewayEvent({ ...heartbeat, eventId: `${heartbeat.eventId}:tampered` }, gatewayPubkeyHex) === false
);
// 37
check('malformed gateway event signature returns false',
  await verifyGatewayEvent({ ...heartbeat, signature: 'not-hex' }, gatewayPubkeyHex) === false
);

// ── Gateway store and idempotency ─────────────────────────────────────────────
console.log('\nGateway store and idempotency');

const memoryStore = new InMemoryGatewayStore({
  watchlist: [base.paycardId],
  sequence: 9,
  sentEventIds: [heartbeat.eventId],
});
const memoryState = await memoryStore.load();

// 38
check('in-memory gateway store persists watchlist and sent event IDs',
  memoryState.watchlist[0] === base.paycardId &&
  memoryState.sentEventIds[0] === heartbeat.eventId &&
  memoryState.sequence === 9
);

const tmpDir = await mkdtemp(join(tmpdir(), 'openrails-tier1-'));
const fileStore = new FileGatewayStore(join(tmpDir, 'gateway-store.json'));
await fileStore.save({
  watchlist: [base.paycardId],
  cursor: null,
  pendingDeliveries: [{
    eventId: heartbeat.eventId,
    webhookUrl: 'http://merchant.local/webhook',
    payload: heartbeat,
    attempts: 0,
    nextAttemptAtMs: 0,
  }],
  sentEventIds: [],
  sequence: 1,
});
const fileState = await fileStore.load();

// 39
check('file-backed gateway store persists pending deliveries',
  fileState.pendingDeliveries.length === 1 &&
  fileState.pendingDeliveries[0].eventId === heartbeat.eventId
);

const pendingStore = new InMemoryGatewayStore(fileState);
const originalFetch = globalThis.fetch;
let capturedIdempotencyKey = '';
globalThis.fetch = async (url, init = {}) => {
  const urlString = String(url);
  if (urlString.includes('merchant.local')) {
    const headers = new Headers(init.headers);
    capturedIdempotencyKey = headers.get('Idempotency-Key') ?? '';
    return new Response('', { status: 200 });
  }
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    result: { data: [], hasNextPage: false, nextCursor: null },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const handle = await startGateway({
  suiRpcUrl: 'http://sui.local',
  packageId: PKG,
  paycardIds: [],
  webhookUrl: 'http://merchant.local/webhook',
  signerKeypair: gatewayKp,
  store: pendingStore,
  intervalMs: 50,
});
await new Promise((resolve) => setTimeout(resolve, 100));
handle.stop();
globalThis.fetch = originalFetch;
const retriedState = await pendingStore.load();

// 40
check('gateway retries pending delivery with idempotency header',
  capturedIdempotencyKey === heartbeat.eventId &&
  retriedState.pendingDeliveries.length === 0 &&
  retriedState.sentEventIds.includes(heartbeat.eventId)
);

class ThrowingSaveStore extends InMemoryGatewayStore {
  async save() {
    throw new Error('simulated store failure');
  }
}

let rpcCallsAfterStoreFailure = 0;
globalThis.fetch = async () => {
  rpcCallsAfterStoreFailure++;
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    result: { data: [], hasNextPage: false, nextCursor: null },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const failureHandle = await startGateway({
  suiRpcUrl: 'http://sui.local',
  packageId: PKG,
  paycardIds: [base.paycardId],
  webhookUrl: 'http://merchant.local/webhook',
  signerKeypair: gatewayKp,
  store: new ThrowingSaveStore({ watchlist: [base.paycardId] }),
  intervalMs: 25,
});
await new Promise((resolve) => setTimeout(resolve, 90));
failureHandle.stop();
globalThis.fetch = originalFetch;

// 41
check('gateway scheduler recovers after store save failure',
  rpcCallsAfterStoreFailure > 1
);

// ── Encrypted Walrus links ───────────────────────────────────────────────────
console.log('\nEncrypted Walrus links');

const encryptedPayload = {
  ...flowPayload,
  envelope: merchantEnvelope,
};
const { blob: encryptedBlob, decryptionKey } = await encryptOpenRailsLink(encryptedPayload);
const decryptedPayload = await decryptOpenRailsLink(encryptedBlob, decryptionKey);
const encryptedBlobText = JSON.stringify(encryptedBlob);

// 42
check('encrypted link round-trips OpenRails payload',
  decryptedPayload.linkType === 'railsflow' &&
  decryptedPayload.intent.paycardId === flowPayload.intent.paycardId &&
  decryptedPayload.merchantAddress === flowPayload.merchantAddress
);
// 43
check('encrypted blob hides plaintext envelope fields',
  !encryptedBlobText.includes('payerPublicKey') &&
  !encryptedBlobText.includes(flowPayload.intent.paycardId) &&
  !encryptedBlobText.includes(flowPayload.merchantAddress)
);
// 44
check('encrypted link rejects wrong key',
  await (async () => {
    try {
      await decryptOpenRailsLink(encryptedBlob, generateEncryptedLinkKey());
      return false;
    } catch {
      return true;
    }
  })()
);
// 45
check('encrypted link rejects tampered ciphertext',
  await (async () => {
    try {
      await decryptOpenRailsLink({
        ...encryptedBlob,
        ciphertext: `${encryptedBlob.ciphertext.startsWith('A') ? 'B' : 'A'}${encryptedBlob.ciphertext.slice(1)}`,
      }, decryptionKey);
      return false;
    } catch {
      return true;
    }
  })()
);
// 46
check('encrypted link rejects tampered authenticated header',
  await (async () => {
    try {
      await decryptOpenRailsLink({ ...encryptedBlob, plaintextType: 'openrails.link.v2' }, decryptionKey);
      return false;
    } catch {
      return true;
    }
  })()
);
// 47
check('encrypted link rejects malformed IV length',
  await (async () => {
    try {
      await decryptOpenRailsLink({ ...encryptedBlob, iv: 'AA' }, decryptionKey);
      return false;
    } catch {
      return true;
    }
  })()
);
// 48
check('encrypted link rejects unknown blob fields',
  await (async () => {
    try {
      await decryptOpenRailsLink({ ...encryptedBlob, unexpected: 'field' }, decryptionKey);
      return false;
    } catch {
      return true;
    }
  })()
);

const encryptedShortLink = buildEncryptedShortLink('0x' + 'cd'.repeat(32), decryptionKey, 'https://rails.to/v1');
const parsedEncryptedShortLink = parseEncryptedShortLink(encryptedShortLink);

// 49
check('encrypted short link keeps key in URL fragment',
  encryptedShortLink.includes('#k=') &&
  parsedEncryptedShortLink.blobId === '0x' + 'cd'.repeat(32) &&
  parsedEncryptedShortLink.decryptionKey === decryptionKey
);
// 50
check('encrypted short link fetch URL excludes fragment key',
  !parsedEncryptedShortLink.fetchUrl.includes('#') &&
  !parsedEncryptedShortLink.fetchUrl.includes(decryptionKey)
);

let uploadedEncryptedBlobText = '';
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('publisher.test')) {
    uploadedEncryptedBlobText = new TextDecoder().decode(init.body);
    return new Response(JSON.stringify({
      newlyCreated: { blobObject: { blobId: '0x' + 'ef'.repeat(32), id: '0xblob' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(uploadedEncryptedBlobText, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
const encryptedUpload = await uploadEncryptedEnvelope(flowPayload, 'https://publisher.test', { epochs: 1 });
const fetchedEncryptedPayload = await fetchEncryptedEnvelope(
  encryptedUpload.blobId,
  'https://aggregator.test',
  encryptedUpload.decryptionKey
);
globalThis.fetch = originalFetch;

// 51
check('uploadEncryptedEnvelope stores encrypted Walrus blob',
  encryptedUpload.shortLink.includes('#k=') &&
  uploadedEncryptedBlobText.includes('openrails.encrypted-link') &&
  !uploadedEncryptedBlobText.includes(flowPayload.merchantAddress)
);
// 52
check('fetchEncryptedEnvelope decrypts Walrus blob',
  fetchedEncryptedPayload.linkType === 'railsflow' &&
  fetchedEncryptedPayload.merchantAddress === flowPayload.merchantAddress
);

// ── Walrus BlobID conversion ─────────────────────────────────────────────────
console.log('\nWalrus BlobID conversion');

// 53
check('hex Walrus BlobID converts to 32 bytes',
  walrusBlobIdToBytes('0x' + 'ab'.repeat(32)).length === 32
);
// 54
check('invalid Walrus BlobID length is rejected',
  (() => {
    try {
      walrusBlobIdToBytes('0x1234');
      return false;
    } catch {
      return true;
    }
  })()
);

// ── Result ────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${total} checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log(`All ${passed} checks passed.`);
