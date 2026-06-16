import {
  calculateAccrualDebt,
  projectStreamAt,
  OpenRailsSDK,
  buildShortLink,
  NETWORKS,
  COIN_TYPES,
  WALRUS_ENDPOINTS,
  signEnvelopeEd25519,
  buildMintPTB,
  buildClaimPTB,
} from './dist/index.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

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

// ── Result ────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${total} checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log(`All ${passed} checks passed.`);
