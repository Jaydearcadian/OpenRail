# OpenRails V1.2 testnet e2e — open a channel, watch it settle

Operator runbook for the V1.2 nonce-lane package. You run this with your own funded
Sui testnet key; nothing here is automated and **no secrets belong in this file**
(env var names only). It proves the full path: create a nonce account → open a
streaming channel (consuming a lane + binding a metadata hash) → claim to depletion
→ read the terminal `SettlementReceipt`.

## Prerequisites

```bash
sui client active-env       # testnet
sui client active-address   # funded; use `sui client faucet` if needed
cd move && sui move test    # 24/24 green
npm --prefix sdk run build  # builds the openrails CLI (dist/cli.js)
```

## 1. Publish the V1.2 package (operator step)

```bash
./scripts/publish-v1-2.sh
```

Copy the **packageId** from the `Published Objects` section, then export it plus your
signer key (Ed25519 `suiprivkey...`). The key is read by name only and never logged.

```bash
export OPENRAILS_PACKAGE_ID=0x<new_v1_2_package_id>
export OPENRAILS_PRIVATE_KEY=suiprivkey1......          # your funded testnet key
CLI="node sdk/dist/cli.js"
```

## 2. Create your NonceAccount (once)

```bash
$CLI nonce-create
# → { "nonceAccountId": "0x<acct>", "digest": "..." }
export NONCE_ACCT=0x<acct>
```

## 3. Open a streaming channel (RailsFlow / direct)

`--coin` is a `Coin<SUI>` object you own (`sui client gas` to list). The open consumes
lane 0 (value sourced live from the NonceAccount) and binds a sample metadata hash.

```bash
$CLI open \
  --coin 0x<your_sui_coin> \
  --amount 100000000 \
  --rate 1000000 \
  --recipient $(sui client active-address) \
  --duration 120 \
  --recovery $(sui client active-address) \
  --nonce-account $NONCE_ACCT \
  --channel 0 \
  --metadata-hash ababababababababababababababababababababababababababababababababab
# → { "paycardId": "0x<paycard>", "nonceChannel": "0", "nonceValue": "0", "digest": "..." }
export PAYCARD=0x<paycard>
```

Recipient == payer here so a single key can drive the whole demo.

## 4. Claim — accrue, then deplete (emits the receipt)

Wait past the duration (here 120s) so the full pool has accrued, then claim. When the
pool is exhausted the channel emits a terminal `SettlementReceipt` (type 0 = depleted).

```bash
$CLI claim $PAYCARD
# → { "settlementReceiptEmitted": true, "digest": "..." }
```

(Alternatively, `$CLI cancel $PAYCARD` before expiry, or `$CLI resolve $PAYCARD` after
expiry, each emit a `SettlementReceipt` of the matching type.)

## 5. Read the proof

The deployed Receipt API indexes `SettlementReceipt` events on a cron, or query chain
directly. Once indexed:

```bash
node sdk/dist/cli.js proof $PAYCARD
node sdk/dist/cli.js receipts get $PAYCARD
```

> The default Receipt API base still points at the V1.1 Worker. To index the V1.2
> package, repoint `services/receipt-api/wrangler.toml` (package id + event filter)
> and redeploy — part of the same Phase-2 repoint as the SDK/web package ids.

## 6. (Optional) prove replay protection

Re-open on the same lane value and watch it abort on-chain:

```bash
$CLI open ... --channel 0 --nonce-value 0   # lane already advanced → aborts (E_NONCE_MISMATCH)
```

Omit `--nonce-value` and the CLI's NonceEngine reads the lane's next value live, so
normal opens always advance correctly; the manual `--nonce-value 0` forces the replay.

## Notes / not-yet-done (Phase 2 continued)

- The RailsCard **vault** flow (`create_sealed_vault` → `unseal_and_mint`) is ABI-synced
  in the SDK but has no CLI command yet — drive it via the SDK builders for now.
- `sdk/scripts/seed-testnet-showcase.mjs` and the gateway operator still use the V1.1
  ABI; update them to the V1.2 open signatures before reusing.
- Product-receipt builders, Worker nonce/receipt routes, and web wallet writes are
  later slices.
