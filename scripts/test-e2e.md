# OpenRails V1 — End-to-End Test Guide

## Tier 1: SDK logic (runs anywhere, zero infrastructure)

```bash
cd sdk && npm run build
node scripts/tier1.mjs
```

All 54 checks should pass. This verifies: accrual math, envelope serialization,
canonical signing and legacy fallback, short links, network addresses, PTB
construction, Ed25519 signing, RailsFlow merchant and invoice binding, gateway
event signatures, gateway store/idempotency behavior, encrypted Walrus links,
and Walrus BlobID conversion.

---

## Tier 2: Walrus round-trip (requires internet, no wallet)

```bash
cd sdk && node --input-type=module <<'EOF'
import { uploadEncryptedEnvelope, fetchEncryptedEnvelope, WALRUS_ENDPOINTS } from './dist/index.js';

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

const { blobId, shortLink, decryptionKey } = await uploadEncryptedEnvelope(
  payload, WALRUS_ENDPOINTS.testnet.publisher, { epochs: 1 }
);
console.log('Encrypted short link prepared:', shortLink.split('#')[0] + '#k=<hidden>');

const resolved = await fetchEncryptedEnvelope(blobId, WALRUS_ENDPOINTS.testnet.aggregator, decryptionKey);
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

### Read-only preflight
```bash
cd sdk
npm run testnet:preflight
```

The preflight checks local CLI/build/env readiness without publishing, writing `.env`,
or printing private keys. It also prints the exact proof commands below.

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
sui client switch --env testnet
sui client publish --gas-budget 100000000
```
Copy the `PackageID` from the output. It looks like `0x...`.

### Export proof env vars
Keep secrets in shell env vars only. Do not edit demo constants and do not write `.env`.

```bash
export PAYER_PRIVATE_KEY='<exportedPrivateKey from sui keytool export>'
export PACKAGE_ID='0x<PackageID from publish output>'
export PAYER_COIN_OBJECT_ID='0x<payer SUI coin object for vault allocation>'
export PAYER_GAS_COIN_OBJECT_ID='0x<second payer SUI coin object for RailsCard gas reserve>'
export FUNDING_COIN_OBJECT_ID='0x<payer SUI coin object for RailsFlow funding>'
```

Find coin object IDs with:
```bash
sui client objects          # find SUI coin objects
sui client object <coin-id> # check value
```

Optional funded-wallet proof runs:
```bash
export RECIPIENT_PRIVATE_KEY='<funded recipient exportedPrivateKey>'
export MERCHANT_PRIVATE_KEY='<funded merchant exportedPrivateKey>'
```

Without those optional keys, RailsCard uses an ephemeral recipient and the payer
sponsors `unseal_and_mint`; RailsFlow uses an ephemeral merchant and the payer
sponsors the merchant claim. If an optional wallet is provided but unfunded, the
payer sponsors that demo transaction as well.

Bearer tokens are hidden by default to avoid leaking spendable or metadata-rich
payloads into logs. Set `OPENRAILS_PRINT_TOKENS=1` only in a private terminal
when you need to inspect raw tokens.

### Run RailsCard demo (outbound grant via SealedVault)
```bash
cd sdk && npx ts-node --esm --project tsconfig.json ../examples/railscard-demo.ts
```

Expected:
- `[PAYER] Vault created`
- `[RECIPIENT] Vault unsealed`
- `[RECIPIENT] Claim TX: <digest>`
- RailsCard waits briefly after unseal so at least one second can accrue before claim
- Explorer URLs printed for proof transactions
- SettlementClaimed event visible in Sui explorer

### Run RailsFlow demo (inbound billing memo)
```bash
cd sdk && npx ts-node --esm --project tsconfig.json ../examples/railsflow-demo.ts
```

Expected:
- `[MERCHANT] RailsFlow billing token prepared`
- `[PAYER] Mint TX: <digest>`
- `[MERCHANT] Settlement claimed, TX: <digest>`
- Explorer URLs printed for proof transactions

### Verify SettlementReceipt on explorer
Go to `https://suiexplorer.com/txblock/<digest>?network=testnet` or run:

```bash
sui client tx-block <digest> --json
```

Look for the `open_rails::events::SettlementReceipt` event. Check:
- `total_paid_to_recipient + residual_returned_to_payer == initial_allocation`

### Proof artifact checklist
- Published `PackageID`
- RailsCard vault creation digest and explorer URL
- RailsCard sponsored or self-funded unseal digest and explorer URL
- RailsCard claim digest and explorer URL
- RailsFlow mint digest and explorer URL
- RailsFlow sponsored or self-funded merchant claim digest and explorer URL
- SettlementReceipt event payload or CLI inspection output

### Verified live testnet proof, 2026-06-17

Published package:
```text
0xfaf26d6a2028446fa61f4171c27f26209dc7951ea8634dc8ce88e1fa125dacf1
```

Proof transactions:

| Step | Digest |
|---|---|
| Publish package | `BAxLBDFWsyghp33CZBDmZNXsmiZQKuFBoqhNqP9aBGCU` |
| RailsCard vault create | `4tbTxaW4ArahKjuqPYjhXkFc1NEgdEeMDPT5kuniAbdq` |
| RailsCard sponsored unseal | `BEeGQPpo8udizbs9uV4VfcMmNjxeJJGQgZQH2bvh3kJd` |
| RailsCard recipient claim | `FAnHgXGwe8PcWyG2oFSJ9GdfnFfch6A2X4asVmcQsFKH` |
| RailsFlow mint | `BT9WmKPohTfK5oGt3RvyPRuJfHeysPuXcRU8vh5m4ANe` |
| RailsFlow sponsored merchant claim | `GMLyfutGD7U7EdqNwUCdfGZjCN3Xc9nwEyj5qw2G4YNQ` |

Verified events:
- `VaultSealed`
- `PaycardMinted`
- `VaultUnsealed`
- `SettlementClaimed` for RailsCard
- `PaycardMinted` for RailsFlow
- `SettlementClaimed` for RailsFlow

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
