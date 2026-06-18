# OpenRails V1

**Intent-Driven Clearing & Settlement Infrastructure for the Machine Economy**

OpenRails converts financial agreements into stateless, cryptographically signed **Permission Envelopes** that initialize isolated **streaming channels** on Sui. Every channel is a single-writer Owned Object — bypassing global consensus sequencing and enabling AI agent swarms to settle concurrently at sub-second latency.

Permission Envelope signatures now cover canonical, domain-separated JSON bytes with recursive key ordering. Verification checks canonical signatures first and falls back to the legacy JSON form for existing tokens.

---

## What Is a Channel?

A **channel** is the active financial pipe created on-chain when a Permission Envelope is claimed. It is a temporary, mathematically sealed tunnel between a payer's funds and a recipient's wallet — treating blockchain capital like bandwidth: open a tap, let value flow continuously by the second, close it with zero financial waste.

Every open channel maintains four critical variables:

| Variable | Field | Role |
|---|---|---|
| **Bound Perimeter** | `id` (UID) | Locks the channel to its original envelope terms |
| **Locked Liquidity** | `allocation_pool: Balance<T>` | Ring-fenced at birth; physically unreachable by the payer |
| **Velocity Pointer** | `max_flow_rate_per_second: u64` | Immutable flow rate — the payer cannot accelerate drain post-mint |
| **Temporal Anchor** | `last_checkpoint_timestamp: u64` | Exact moment of last balance extraction; accrual calculates from here |

Channels do not burn gas continuously. Settlement is **lazy**: the contract computes `Δt × rate` at claim time, transfers the accrued amount, and advances the checkpoint. Gas is paid only by transactions that open, claim, resolve, or close a channel.

---

## Two Link Forms, Two Birth Paths

A channel is born from one of two paths depending on who initiates the payment.

### RailsCard — Outbound Grant (vault birth)

The payer initiates. Funds are deposited into a **SealedVault** (shared object). The payer signs the vault parameters off-chain and passes the bearer token to any recipient — wildcard or specific. The recipient presents the token; the Move contract verifies the payer's Ed25519 or secp256k1 signature **on-chain** before minting the channel.

```
Payer → create_sealed_vault() → shared SealedVault<T>
      → signs params off-chain → Base64 RailsCard token → recipient

Recipient → unseal_and_mint()
          ↳ ed25519_verify() / secp256k1_verify() on-chain
          ↳ Channel minted to recipient → streaming begins
```

**Stream timing (payer's choice per token):**
- `start_timestamp = 0` → stream starts at unseal time — recipient gets the full duration
- `start_timestamp = T` → stream starts at payer's fixed time — window may be partially elapsed

**Tier-2 gasless UX:** the vault also carries a small `gas_reserve` (SUI). At `unseal_and_mint`, that reserve is dispensed to the recipient in the same transaction — so every subsequent claim is self-funded. Only the single unseal call needs external gas, and that can be protocol-sponsored (`sponsor.ts`). Set `gasAmount = 0` to disable.

### RailsFlow — Inbound Billing Memo (direct birth)

The merchant initiates. They create a signed invoice with their payout address hardcoded. The payer reviews the fixed parameters and calls `mint_and_fund_envelope` directly — funding the channel straight to the merchant. No vault, no escrow window, no shared object. The birth stays on Sui's **owned-object fast path** — fully parallel, consensus-free.

```
Merchant → signs intent (hardcoded payout) → Base64 RailsFlow token → payer

Payer → reviews fixed params → mint_and_fund_envelope()
      ↳ Channel owned by merchant → streaming begins
```

The merchant's invoice signature is verified off-chain by the payer's client before they fund. Forcing RailsFlow through a vault would drag inbound billing off the fast path onto the sequenced consensus path — defeating the architecture's core parallelism guarantee.

---

## Channel Lifecycle

```
[ PHASE 1: BIRTH ]
  RailsCard: unseal_and_mint() → on-chain sig verify → Channel born (Status: Active)
  RailsFlow: mint_and_fund_envelope() → Channel born (Status: Active)

[ PHASE 2: STREAMING ]
  Value flows off-chain via Gateway heartbeats while tokens accumulate silently on-chain.
  Recipient calls claim_settlement_round() at any time to extract accrued balance.

[ PHASE 3: SETTLEMENT ]
  Depleted  → recipient claimed full pool → SettlementReceipt(type=0)
  Expired   → duration elapsed; accrued value is paid to recipient, unearned residual returns to recovery → SettlementReceipt(type=1)
  Cancelled → payer cancels; remaining balance refunded → SettlementReceipt(type=2)
  Channel object is destroyed or marked depleted. Cannot be reopened.
```

Every terminal state fires a single **`SettlementReceipt`** event on-chain — the canonical, un-tamperable audit log entry. The invariant holds at all times:

```
total_paid_to_recipient + residual_returned_to_payer == initial_allocation
```

This is the single event a Web2 accounting system needs to subscribe to. The SDK exports `querySettlementReceipts()` and `getSettlementReceiptByPaycardId()` to normalize V1 receipt events into API-ready records keyed by transaction digest and event sequence.

---

## Streaming Mechanics

```
accrued = (current_time − last_checkpoint) × max_flow_rate_per_second
          capped at remaining pool balance
```

The recipient calls `claim_settlement_round` whenever they want. Accrual since the last claim is calculated inline and transferred atomically. The checkpoint advances. The next claim calculates from there.

**STN-Delta Residual Recovery:** When the stream window closes, accrued-but-unclaimed value is paid to the recipient first. Only the unearned buffer is swept back to the payer's recovery address via `resolve_residual_delta_expiry`. No manual clawback, no relayer fee extraction, no leftover dust.

---

## Dynamic Stream Event Gateway

Because Sui does not push events to HTTP endpoints, OpenRails ships an off-chain **Stream Event Gateway** — a Node.js daemon that projects accrual state without touching the chain and delivers signed heartbeats to merchant webhooks.

```
[ GATEWAY LOOP — every 10 s ]
  1. Fetch watched channel object via SuiClient.getObject()
  2. Mirror calculate_accrual_debt in TypeScript → project current balance
  3. Sign canonical StreamHeartbeat with gateway Ed25519 keypair
  4. POST signed JSON payload to merchant webhook URL with idempotency headers
  5. On SettlementReceipt event → emit signed terminal notification → remove from watch list after delivery succeeds
```

Merchants receive a standard HTTPS webhook interface over a Sui event stream, no Sui SDK required on their side. Heartbeats, buffer-low alerts, and terminal notifications carry Ed25519 signatures over canonical, domain-separated JSON with `schemaVersion`, `eventId`, `sequence`, `timestamp`, and `paycardId`; merchants verify with `verifyGatewayEvent(event, gatewayPublicKeyHex)`.

Gateway costs **zero gas** because it reads state and projects math off-chain. On-chain gas is still paid by whichever wallet submits mint, claim, expiry, cancel, or unseal transactions.

---

## Architecture

```
[ OFF-CHAIN ]
  RailsCard: Payer signs SealedVault params → Base64 token
  RailsFlow: Merchant signs invoice → Base64 token
  Gateway:   accrual.ts mirrors calculate_accrual_debt → canonical StreamHeartbeat → webhook

[ ON-CHAIN ]
  RailsCard: unseal_and_mint() → ed25519/secp256k1_verify → Channel<T> (owned by recipient)
  RailsFlow: mint_and_fund_envelope()                     → Channel<T> (owned by merchant)

[ STREAMING ]
  claim_settlement_round() → lazy accrual math → coin transfer → checkpoint advance
  resolve_residual_delta_expiry() → accrued-to-recipient + unearned residual-to-recovery

[ SETTLEMENT ]
  SettlementReceipt event → canonical audit log (depleted | expired | cancelled)

[ INTEGRATIONS ]
  Walrus    → 32-byte BlobID anchored in channel at birth; heavy metadata stored off-chain
  DeepBook V3 → inline swap in same PTB: base coin → merchant's preferred token
```

---

## Ecosystem Integrations

### Walrus
Enterprise agreements carry heavy compliance metadata — multi-sig rules, IP whitelists, vendor API keys, split configurations. OpenRails pushes this to Walrus and anchors only the 32-byte BlobID inside the channel struct. On-chain storage stays minimal; off-chain rules stay verifiably immutable.

Permission Envelopes can also be uploaded as encrypted Walrus blobs. `uploadEncryptedEnvelope()` wraps the signed payload in AES-256-GCM, stores only ciphertext on Walrus, and returns a `rails.to/v1/{blobId}#k=...` link whose fragment key is not sent to resolvers or aggregators during HTTP requests.

### DeepBook V3
Settlement claims can route through DeepBook's pool inside the same Programmable Transaction Block. A merchant invoicing in SUI can receive a USDC stream — the swap happens atomically at claim time:

```
execute_claim_round (open_rails)           → Coin<USDC>
   ↓ threaded in the same PTB
pool::swap_exact_base_for_quote (deepbook) → (USDC remainder, Coin<SUI>, DEEP remainder)
   ↓
quote → recipient   |   remainders → sender
```

The integration lives entirely at the transaction layer (`sdk/src/ptb.ts` → `buildClaimAndSwapPTB`) — the OpenRails Move package carries **no DeepBook dependency**, so the core always builds. *(Fill in the verified DeepBook package ID, pool IDs, and DEEP token type in `sdk/src/network.ts` before running.)*

---

## Repository Layout

```
move/
  Move.toml
  sources/
    paycard_v1.move       — channel primitive: Paycard<T>, execute_claim_round,
                            claim_settlement_round, resolve_residual_delta_expiry, cancel_paycard
    sealed_vault.move     — RailsCard vault: SealedVault<T>, create_sealed_vault,
                            unseal_and_mint (on-chain Ed25519/secp256k1 verify), cancel_vault
    events.move           — typed events for all state transitions including SettlementReceipt
  tests/
    paycard_tests.move       — 11 unit tests: mint, claims, cancellation auth,
                               expiry residual split, early-resolve abort,
                               non-recipient entry and composable claim aborts
    sealed_vault_tests.move  — 5 unit tests: vault creation, invalid sig rejection,
                               cancel, unauthorized cancel, start sentinel

sdk/
  src/
    types.ts      — all interfaces: intent, envelope, link types, PTB params, SettlementReceiptV1
    sdk.ts        — OpenRailsSDK.serializePayload / deserializePayload
    canonical.ts  - deterministic canonical JSON bytes and domain separation
    link-encryption.ts - AES-GCM encrypted link helpers and fragment-key URLs
    signer.ts     - signEnvelope*, verifyEnvelope, RailsFlow merchant and invoice binding
    vault.ts      — buildVaultMessage, signVaultEd25519, signVaultSecp256k1
    walrus.ts     — plaintext and encrypted upload/fetch helpers, BlobID conversion, WALRUS_ENDPOINTS
    ptb.ts        — PTB builders for all on-chain operations
    network.ts    — NETWORKS constants, COIN_TYPES
    sponsor.ts    — prepareForSponsorship, executeSponsoredTx
    accrual.ts    — calculateAccrualDebt, projectStreamAt (TypeScript mirror of Move math)
    heartbeat.ts  - canonical signed heartbeat, buffer-low, terminal event helpers
    gateway-store.ts - in-memory and file-backed gateway persistence
    gateway.ts    - startGateway (polling loop, retries, idempotency, signed terminal detection)
    receipts.ts   - SettlementReceipt parsing, query helpers, and V1 receipt normalization

examples/
  railscard-demo.ts   — RailsCard flow: vault creation → signing → unseal → claim
  railsflow-demo.ts   — RailsFlow flow: merchant invoice → payer funds → merchant claims
  gateway-demo.ts     — offline gateway round-trip: local receiver verifies 3 signed heartbeats
```

---

## Getting Started

### Prerequisites
- [`suiup`](https://docs.sui.io/guides/developer/getting-started/sui-install) — installs `sui` CLI
- Node.js 20+

### Build Move package
```bash
cd move
sui move build
sui move test
```

### Build SDK
```bash
cd sdk
npm install
npm run build
```

### Deploy to testnet
```bash
cd sdk
npm run testnet:preflight

cd ../move
sui client publish --gas-budget 100000000
```

### Run examples
```bash
export PAYER_PRIVATE_KEY="<exportedPrivateKey from sui keytool export>"
export PACKAGE_ID="0x<PackageID from publish output>"
export PAYER_COIN_OBJECT_ID="0x<payer SUI coin object for vault allocation>"
export PAYER_GAS_COIN_OBJECT_ID="0x<second payer SUI coin object for RailsCard gas reserve>"
export FUNDING_COIN_OBJECT_ID="0x<payer SUI coin object for RailsFlow funding>"
# Optional funded-wallet proof runs:
# export RECIPIENT_PRIVATE_KEY="<funded recipient exportedPrivateKey>"
# export MERCHANT_PRIVATE_KEY="<funded merchant exportedPrivateKey>"

cd ../sdk
npx ts-node --esm --project tsconfig.json ../examples/railscard-demo.ts
npx ts-node --esm --project tsconfig.json ../examples/railsflow-demo.ts
npx ts-node --esm --project tsconfig.json ../examples/gateway-demo.ts
```

RailsCard sponsors `unseal_and_mint` for an ephemeral or unfunded recipient by
default. RailsFlow sponsors the merchant claim for an ephemeral or unfunded
merchant by default. Demo transactions print digests and testnet explorer URLs
for proof artifacts. Bearer tokens are hidden by default; set
`OPENRAILS_PRINT_TOKENS=1` only in a private terminal when you need to inspect
raw tokens.

---

## Security Properties

| Threat | Mitigation |
|--------|-----------|
| Over-extraction from stream | `calculate_accrual_debt` hard-capped at pool balance |
| Non-recipient claiming | `execute_claim_round` and `claim_settlement_round` assert `sender == paycard.recipient` |
| Unauthorized cancel | `cancel_paycard` asserts `sender == paycard.payer` |
| Unauthorized delta sweep | `resolve_residual_delta_expiry` asserts `sender ∈ {recipient, payer, recovery_target}` |
| Vault replay | Nonce embedded in signed message; one vault = one claim |
| Vault sig forgery | `ed25519_verify` / `secp256k1_verify` in Move — invalid sig aborts `EInvalidSignature` |
| Gas-reserve tampering | `gas_amount` included in signed vault message — any mismatch fails sig verify |
| Vault cancel by stranger | `cancel_vault` asserts `sender == vault.payer` |
| Payload tampering (RailsFlow) | Off-chain signature over intent plus merchant address; payer verifies before funding |
| Walrus link disclosure | Optional AES-GCM encrypted blobs keep envelope contents off public Walrus; fragment key stays client-side |
| Timestamp manipulation | Clock fed from Sui's trusted shared Clock object (`0x6`) |

---

## Hackathon Tracks — Overflow 2026

- **DeFi & Payments** — push-primitive streaming escrow, STN-Delta atomic buffer recovery, DeepBook inline swap routing
- **Agentic Web** — owned-object parallelism for AI agent swarm micro-billing, secp256k1 support for EVM-key agents, sponsored transaction gasless UX
