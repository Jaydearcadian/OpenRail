# OpenRails web — wallet writes + e2e

The dashboard can open/claim/cancel/resolve real channels via **@mysten/dapp-kit**
(Sui wallet connect) + **@mysten/enoki** (Google/Facebook/Twitch zkLogin with sponsored
gas). This is an operator runbook — you provide the secrets and run the live flow.

## 1. Prerequisites

- Publish the V1.2 package (`scripts/publish-v1-2.sh`) and note its package id.
- An **Enoki API key** (Enoki developer portal) with the OpenRails move-call targets
  allowlisted for sponsorship: `mint_and_fund_envelope`, `claim_settlement_round`,
  `cancel_paycard`, `resolve_residual_delta_expiry`, `create_nonce_account`.
- A **Google OAuth client id** (and optionally Facebook/Twitch) with the redirect URL
  set to this app's origin (e.g. `http://localhost:5173`).

## 2. Configure

```bash
cd apps/web
cp .env.example .env.local
# edit .env.local:
#   VITE_OPENRAILS_PACKAGE_ID = 0x<your published V1.2 package>
#   VITE_ENOKI_API_KEY        = enoki_public_...
#   VITE_GOOGLE_CLIENT_ID     = ...apps.googleusercontent.com
#   VITE_SUI_NETWORK          = testnet
npm install
npm run dev
```

`.env.local` is gitignored — never commit it. If Enoki vars are absent the zkLogin
options simply don't appear; standard Sui wallet connect still works.

## 3. End-to-end flow

1. Open the dashboard → **Open a rail** (control nav, or the "Write Access · LIVE" item).
2. **Connect** → "Sign in" with Google (zkLogin) or pick a Sui wallet.
3. Fill the form (allocation SUI, rate MIST/sec, duration, recipient, recovery) and
   **Open channel**. Watch the write states: pending-signature → submitted → finalizing →
   confirmed (with an explorer link). The new paycard id appears.
4. **Claim accrued** (after some seconds) → repeat to depletion → a terminal
   `SettlementReceipt` is emitted; it shows in the **Receipts** surface once the Worker
   indexes it (repoint the Worker `OPENRAILS_PACKAGE_ID` to V1.2 first — see
   `scripts/testnet-e2e-v1-2.md`).
5. **Cancel** (before expiry) or **Resolve** (after expiry) show an irreversible-settlement
   warning, then settle.

## 4. Caveats (honest)

- **Gas vs funding:** Enoki sponsors *gas*, but the channel allocation is real SUI the
  payer must hold. New zkLogin users still need testnet SUI (faucet) to fund a channel;
  the UI shows an `insufficient-balance` state otherwise.
- **Non-sponsored wallets** need a *separate* SUI coin for gas (a coin used as a Move
  input can't also pay gas). zkLogin (sponsored) avoids this. Have ≥2 coins, or merge.
- **NonceAccount discovery** is cached in `localStorage` per address/network/package. A
  fresh browser creates a new NonceAccount (lanes restart). A durable cross-device lookup
  needs a future `NonceAccountCreated` event + indexer.
- **"Email" zkLogin** isn't a standard Enoki OAuth provider; the menu shows whichever of
  Google/Facebook/Twitch you configured.
- The JS bundle is large (full Sui + wallet stack); add `manualChunks` later if needed.

## 5. Not in this surface yet

RailsCard vault open/unseal (use the `openrails` CLI — `open-vault`/`unseal`), access
credentials, and lifecycle buttons on arbitrary showcase streams (the contract enforces
role auth on-chain regardless).
