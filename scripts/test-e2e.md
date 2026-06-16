# OpenRails V1 — End-to-End Test Guide

## Tier 1: SDK logic (runs anywhere, zero infrastructure)

```bash
cd sdk && npm run build
node scripts/tier1.mjs
```

All 31 checks should pass. This verifies: accrual math, envelope serialization,
short links, network addresses, PTB construction, Ed25519 signing, RailsFlow
merchant binding, gateway event signatures, and Walrus BlobID conversion.

---

## Tier 2: Walrus round-trip (requires internet, no wallet)

```bash
cd sdk && node --input-type=module <<'EOF'
import { uploadEnvelope, fetchEnvelope, buildShortLink, WALRUS_ENDPOINTS } from './dist/index.js';

const payload = {
  linkType: 'railscard',
  vaultObjectId: '0xvault',
  vaultSignature: 'ab'.repeat(64),
  envelope: { payerPublicKey: '0xtest', nonce: 1, signature: '0xsig', curve: 'ed25519' },
  intent: {
    paycardId: '0x1',
    asset: { packageId: '0x2', moduleName: 'sui', typeArgument: '0x2::sui::SUI' },
    allocationPoolSize: '1000', maxFlowRatePerSecond: '10',
    startTimestamp: 0, durationSeconds: 100, residualDeltaRecipient: '0xrec',
  },
};

const { blobId, shortLink } = await uploadEnvelope(
  payload, WALRUS_ENDPOINTS.testnet.publisher, { epochs: 1 }
);
console.log('Short link:', shortLink);

const resolved = await fetchEnvelope(blobId, WALRUS_ENDPOINTS.testnet.aggregator);
console.log('Round-trip OK:', resolved.linkType === 'railscard');
EOF
```

---

## Tier 3: Offline gateway demo (requires internet for npm, then runs offline)

```bash
cd sdk && npx ts-node --esm --project tsconfig.json ../examples/gateway-demo.ts
```

Expected output: 3 heartbeats received by local merchant server, all signatures valid.

---

## Tier 4: Sui testnet (requires sui CLI + funded wallet)

### Install sui CLI
```bash
curl -fsSL https://raw.githubusercontent.com/MystenLabs/suiup/refs/heads/main/install.sh | bash
sui --version
```

### Get testnet SUI
```bash
sui client new-address ed25519        # or use existing wallet
sui client faucet                     # request testnet SUI
sui client gas                        # confirm balance > 0
```

### Build and test Move package
```bash
cd move
sui move build                        # must complete with no errors
sui move test                         # must show: 16 tests passed
```

Expected test output:
```
Test result: OK. Total tests: 16; passed: 16; failed: 0
```

### Deploy to testnet
```bash
sui client publish --gas-budget 100000000
```
Copy the `PackageID` from the output. It looks like `0x...` (64 hex chars).

### Update examples with your package ID
Edit `examples/railscard-demo.ts` and `examples/railsflow-demo.ts`:
```typescript
const PACKAGE_ID = "0x<your-deployed-package-id>";
```

Also update the coin object IDs for your wallet:
```bash
sui client objects          # find a SUI coin object
sui client object <coin-id> # check its value
```

### Run RailsCard demo (outbound grant via SealedVault)
```bash
cd sdk && npx ts-node --esm ../examples/railscard-demo.ts
```

Expected:
- `[PAYER] Vault created, TX: <digest>`
- `[RECIPIENT] Vault unsealed, TX: <digest>`
- `[RECIPIENT] Claim TX: <digest>`
- SettlementClaimed event visible in Sui explorer

### Run RailsFlow demo (inbound billing memo)
```bash
npx ts-node --esm ../examples/railsflow-demo.ts
```

Expected:
- `[MERCHANT] RailsFlow token: ...`
- `[PAYER] Minting channel, TX: <digest>`
- `[MERCHANT] Claiming settlement, TX: <digest>`

### Verify SettlementReceipt on explorer
Go to `https://testnet.suivision.xyz/txblock/<digest>` and look for the
`open_rails::events::SettlementReceipt` event. Check:
- `total_paid_to_recipient + residual_returned_to_payer == initial_allocation`

---

## Tier 5: Short link resolver

```bash
cd services/resolver && npm install && npm run dev
# Resolver now listening on http://localhost:8787

# In another terminal (after Tier 2 upload):
curl http://localhost:8787/v1/<blobId>
# Returns the full JSON envelope

curl http://localhost:8787/v1/nonexistent
# Returns: 404 Envelope not found or expired
```
