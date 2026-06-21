# OpenRails Handoff

Last updated: 2026-06-21 (V1.2 full stack + Console frontend)

## Current release state

OpenRails V1.1 is tagged as `v1.1.0-testnet` (commit `cae801a`). The active working branch is `console-app`, which contains the full V1.2 implementation on top of V1.1.

Recent commits on `console-app`:

```text
6f86ae6  Replace frontend with the Console operator app (no narrative)
3459462  Merge branch 'v1-2-access-credentials' into console-app
10a5450  Add V1.2 access credentials (payer-signed) — SDK + Worker + CLI
80e06ed  Add web wallet write surface (dApp Kit + Enoki zkLogin)
aa20f0b  Add V1.2 product-receipt layer (SDK) + Worker nonce route
cf909223 Add RailsCard vault CLI (open-vault/unseal)
df0b53a  Sync SDK to V1.2 ABI; add NonceEngine + CLI writes
3221eac  Add V1.2 nonce-lane + metadataHash on-chain foundation
cae801a  Harden release staging hygiene                          ← v1.1.0-testnet tag
```

V1.2 Move package **published to testnet** on 2026-06-21.

**V1.2 package ID:** `0x4a42fd8493d0929879b2cbd4e19226468867f2c4a4dece8a59d317911d172b2c`
**Publish tx:** `6ofGhCShZgyFxGwk1y1Y8suEqkvVdkyxn4otD5QByYy6`
**UpgradeCap:** `0xfb7762e267f119f0ce9ca21469e3c63323e89b73e19d0581c130c836694d578f`

`wrangler.toml` and `apps/web/src/config.ts` have been repointed to the V1.2 package. Worker redeployed 2026-06-21 with `nodejs_compat` flag. Indexing V1.2 receipts on 5-min cron.

## What V1.1 contains

### Move protocol

- `move/sources/paycard_v1.move`
  - `Paycard<T>` is now a shared V1.1 channel primitive.
  - Recipient can claim while payer can cancel without object handoff.
  - Cancellation pays accrued value to recipient and routes residual through STN-Delta fields.
  - Accrual math caps safely before `u64` multiplication overflow.
- `move/sources/events.move`
  - Mint, cancel, and terminal receipt events carry richer channel terms.
  - `SettlementReceipt` includes initial allocation, rate, start, duration, STN-Delta recipient, and residual delta amount.
- `move/sources/sealed_vault.move`
  - RailsCard unseal opens a shared Paycard channel.
- `move/tests/paycard_tests.move`
  - Covers shared channel flow, cancellation semantics, expiry, depletion, and overflow cap.

### SDK

- `sdk/src/api.ts` — Typed public Worker API client.
- `sdk/src/proof.ts` — Public proof object builder and trust boundary labels.
- `sdk/src/browser.ts`, `sdk/src/worker.ts` — Browser and Worker safe entrypoints.
- `sdk/src/cli.ts` — Public `openrails` CLI (V1.1: read-only health/receipts/streams/proofs).
- `sdk/package.json` — Export map for root, `/browser`, `/worker`, `/api`. `bin.openrails` points at `dist/cli.js`. `files` allowlist limits package contents to `dist/`.
- `sdk/scripts/*showcase*.mjs`, `sdk/scripts/gateway-operator.mjs` — Testnet seeding, verifying, and gateway operation scripts.

### Receipt API and gateway projection

- `services/receipt-api/src/handler.ts` — Public read routes for receipts, streams, and proofs. Signed gateway event collector. Admin receipt indexer trigger.
- `services/receipt-api/src/storage.ts` — D1 and in-memory receipt/gateway projection storage.
- `services/receipt-api/src/indexer.ts` — Cursor-based SettlementReceipt event indexer.
- `services/receipt-api/migrations/0001_receipt_storage.sql` — D1 schema for gateway events, paycard states, settlement receipts, and indexer state.
- `services/receipt-api/wrangler.toml` — V1.1 package configuration and scheduled indexer.

### Receipts and proof layer

- V1.1 has an authoritative onchain `SettlementReceipt` event.
- The SDK parses and normalizes settlement receipts as `SettlementReceiptV1` and `IndexedSettlementReceiptV1`.
- The Worker indexes terminal settlement receipts and exposes receipt/proof routes.
- Gateway events are signed offchain projections, not authoritative settlement receipts.

### Testnet proof artifact

- `scripts/openrails-v1-1-showcase.manifest.json` — Public testnet package, flow, receipt, and transaction proof metadata. No private keys or secrets.

## What V1.2 adds

### Move (implemented, NOT yet published)

- `move/sources/nonce_account.move` — Per-payer replay guard. `NonceAccount { payer, lanes: Table<nonce_channel u64, next_nonce_value u64> }`. Functions: `create_nonce_account` / `verify_and_consume` (atomically checks + increments, aborts entire tx on stale value — replay-safe) / `next_nonce` (read-only, used by `NonceEngine`). Wired into both RailsFlow and RailsCard open paths.
- `move/sources/paycard_v1.move` — Added `metadata_hash: vector<u8>` field; `mint_and_fund_envelope` now takes `nonce_account: &mut NonceAccount`, `nonce_channel: u64`, `metadata_hash: vector<u8>`; `PROTOCOL_VERSION = 12`.
- `move/sources/sealed_vault.move` — Added `nonce_channel` and `metadata_hash` fields; `build_vault_message` extended to include both; `create_sealed_vault` takes `&mut NonceAccount`.
- `move/sources/events.move` — Added `ChannelMetadataAnchored` event (emitted at mint with `paycard_id` + `metadata_hash`).

### SDK

- `sdk/src/nonce.ts` — `createNonceEngine({ client, packageId, payer, nonceAccountId })` → `{ peek, next, reset }`. Uses `devInspect` on `next_nonce` + BCS decode. Local reservation for bursts; stale-value auto-retry in `useChannelWrite`.
- `sdk/src/product-receipt.ts` — `computeMetadataHash` / `metadataHashHex` / `verifyMetadataHash`; `createPaymentReceipt` / `createSettlementReceipt` / `createResidualRecoveryReceipt`; `ProductReceiptV1` schema; deterministic `receiptId`.
- `sdk/src/access-credential.ts` — Payer-signed `AccessCredentialV1`; `issueAccessCredential` / `verifyAccessCredential` (sig → payer-address match → expiry → channel active); encode/parse/header helpers; `channelResolverFromClient` / `channelResolverFromApi`.
- `sdk/src/channel-state.ts` — `getChannelState` reads live `Paycard` object → `{ status, active, poolBalance, … }`.
- `sdk/src/vault.ts` — `VaultParams` gained `nonceChannel`, `metadataHash`; `buildVaultMessage` extended.
- `sdk/src/ptb.ts` — `buildMintPTB` + `buildCreateVaultPTB` updated with nonce/metadata args; added `buildCreateNonceAccountPTB`.
- `sdk/src/cli.ts` — Added write commands: `nonce-create`, `open`, `open-vault`, `unseal`, `claim`, `cancel`, `resolve`, `credential issue`, `credential verify`.

### Receipt API Worker — new routes

- `GET /v1/nonces/:nonceAccountId/:lane` — Calls `next_nonce` on-chain via `devInspect`. Returns `{ nonceAccountId, lane, nextNonce }`.
- `POST /v1/access/verify` — Verifies `AccessCredentialV1` (signature → payer-address match → expiry → channel active). Body: `{ credential: "<token>" }`. Response: `{ granted, reason, paycardId?, service? }`.

### Web app — Console design

The frontend was completely rebuilt as a dense operator console. The old Stream/landing design and all V1.1 marketing components were removed.

Design system:
- `apps/web/src/console.css` — Single authoritative stylesheet. CSS vars, grid background, `.app`/`.side`/`.appbar`/`.nav`/`.nitem`, `table.dt` (dense mono table), `.jsonbox`, `.pline`/`.acc`/`.stream-card`/`.form`/`.status-line`, connect menu, responsive.
- Typography: IBM Plex Sans (body) + Geist Mono (mono), loaded via Google Fonts CDN in `index.html`.
- Palette: dark grid, oklch accent colors.

Architecture:
- Boots straight to `<ConsoleShell />` — no landing page, no marketing copy.
- Keyboard nav: `1/2/3` switch panels, `⌘K` focuses search, `Esc` dismisses.
- Panels: Overview, Write, Rails, Receipts, Proof, Nonces, Credentials.

Wallet integration:
- `@mysten/dapp-kit` 0.20.0 — standard Sui wallet connect (any Sui-compatible wallet).
- `@mysten/enoki` 0.11.0 — Google / Facebook / Twitch zkLogin with sponsored gas.
- Both pin `@mysten/sui` v1.x; Vite `resolve.dedupe` collapses multiple copies.
- `ConnectMenu.tsx` — zkLogin provider buttons + standard wallet selector; shows address, balance, disconnect when connected.

Write capability:
- `useChannelWrite.ts` — 13-state write machine. States: `idle`, `disconnected`, `wrong-network`, `insufficient-balance`, `pending-signature`, `submitted`, `finalizing`, `confirmed`, `stale-nonce`, `rejected`, `failed`. Auto-creates `NonceAccount` on first open (cached in `localStorage` per address+network+package). Stale-nonce retry built in.
- Operations: `open` (RailsFlow mint), `claim`, `cancel`, `resolve`.
- RailsCard in-browser (`openVault`) is pending — currently CLI-only.

## Cloudflare and hosting operations

This section records repo-known facts only. Unknown Cloudflare account, dashboard, project, custom domain, and secret values must be filled in after operator verification.

### Source-of-truth matrix

| Surface | Source file | Current repo-known fact |
| --- | --- | --- |
| Receipt API Worker | `services/receipt-api/wrangler.toml` | Worker name `openrails-receipt-api`, entrypoint `src/handler.ts`, compatibility date `2026-06-18`. |
| Receipt API public base | `sdk/src/cli.ts`, `apps/web/src/services/openrailsApi.ts` | Default URL `https://openrails-receipt-api.microcosm.workers.dev`. |
| Receipt API package ID | `services/receipt-api/wrangler.toml`, web API client, showcase manifest | V1.2 package `0x4a42fd8493d0929879b2cbd4e19226468867f2c4a4dece8a59d317911d172b2c` (published 2026-06-21). V1.1 historical: `0x7cb4ca17…`. |
| Move generated publish metadata | `move/Published.toml` | V1.2 package (published 2026-06-21). V1.1 cut was at `0x7cb4ca17…`; pre-V1.1 legacy at `0xfaf26d6a…`. |
| Resolver Worker | `services/resolver/wrangler.toml` | Worker name `openrails-resolver`, entrypoint `src/handler.ts`, compatibility date `2024-01-01`. |
| Web app | `apps/web/package.json` | Vite React console app, `console-app` branch. Write-capable when package ID + Enoki secrets are set. |
| SDK CLI | `sdk/package.json`, `sdk/src/cli.ts` | `openrails` bin, V1.2 adds write commands. |

### Receipt API Worker

Operational facts:

| Item | Value |
| --- | --- |
| Worker name | `openrails-receipt-api` |
| Directory | `services/receipt-api` |
| Entrypoint | `services/receipt-api/src/handler.ts` |
| Local server | `services/receipt-api/src/server.ts` |
| Local default port | `8788` |
| Build/test | `npm --prefix services/receipt-api test` |
| Deploy | `npm --prefix services/receipt-api run deploy` |
| Public default URL | `https://openrails-receipt-api.microcosm.workers.dev` |
| Sui network | `testnet` |
| Sui RPC | `https://fullnode.testnet.sui.io:443` |
| OpenRails package | `0x4a42fd8493d0929879b2cbd4e19226468867f2c4a4dece8a59d317911d172b2c` (V1.2, published 2026-06-21) |
| Cron | every five minutes, `*/5 * * * *` |

Required Cloudflare secrets, names only:

```text
GATEWAY_PUBLIC_KEY_HEX
ADMIN_TOKEN
```

Do not write secret values to repo, docs, logs, issue comments, or release notes.

Configured D1 binding:

| Item | Value |
| --- | --- |
| Binding | `RECEIPT_DB` |
| Database name | `openrails-receipt-api` |
| Database ID | `4fc647eb-95b2-4d84-8842-d7a7fdb59080` |
| Migrations directory | `services/receipt-api/migrations` |
| Migration file | `services/receipt-api/migrations/0001_receipt_storage.sql` |

Receipt API route table:

| Method | Route | Auth | Storage | Behavior |
| --- | --- | --- | --- | --- |
| `GET` | `/health` | none | none | Returns `{ "ok": true }`. |
| `GET` | `/v1/receipts` | none | optional | Lists indexed settlement receipts from D1, falls back to live Sui event queries. Query params: `limit`, `order`, `cursorTxDigest`, `cursorEventSeq`, `paycardId`, `payer`, `recipient`, `settlementType`. |
| `GET` | `/v1/receipts/:paycardId` | none | optional | Returns terminal receipt for a paycard or `receipt_not_found`. |
| `GET` | `/v1/streams/:paycardId` | none | required | Returns latest signed gateway projection state or `stream_not_found`. |
| `GET` | `/v1/streams/:paycardId/events` | none | required | Lists signed gateway events. Query params: `limit`, `cursor`. |
| `GET` | `/v1/proofs/:paycardId` | none | optional | Joins latest stream state, recent gateway events, terminal receipt, explorer links, and trust boundaries. |
| `GET` | `/v1/nonces/:nonceAccountId/:lane` | none | none | Calls `next_nonce` on-chain via `devInspect`. Returns `{ nonceAccountId, lane, nextNonce }`. V1.2. |
| `POST` | `/v1/access/verify` | none | none | Verifies `AccessCredentialV1`. Body: `{ credential }`. Response: `{ granted, reason, paycardId?, service? }`. V1.2. |
| `POST` | `/v1/gateway/events` | gateway signature | required | Verifies signed gateway event with `GATEWAY_PUBLIC_KEY_HEX`, stores idempotently. |
| `POST` | `/admin/index/receipts/run` | `ADMIN_TOKEN` | required | Runs receipt indexer manually. |

Important route behaviors:

- Gateway event duplicates with identical payload are accepted as duplicates.
- Gateway event duplicates with changed payload return conflict.
- Missing D1 storage returns storage unavailable for storage-dependent routes.
- Sui RPC failures map to upstream error responses for live query fallback.
- Gateway projections are not authoritative settlement records.
- `SettlementReceipt` events are the authoritative terminal accounting source.

### D1 schema and indexing ownership

Tables from `services/receipt-api/migrations/0001_receipt_storage.sql`:

| Table | Purpose |
| --- | --- |
| `gateway_events` | Stores signed gateway events by `event_id`. |
| `paycard_states` | Stores latest projected state per paycard. |
| `settlement_receipts` | Stores indexed terminal settlement receipt payloads. |
| `indexer_state` | Stores receipt indexer cursor. |

Receipt indexer facts:

- Implementation: `services/receipt-api/src/indexer.ts`.
- Indexer name: `settlement_receipts_v1`.
- Event queried: `${packageId}::events::SettlementReceipt`.
- Order: ascending. Page limit: `50`.
- Cursor fields: transaction digest and event sequence.
- Cursor advances only after storage writes succeed.
- Scheduled Worker event runs the indexer every five minutes.

### Gateway operator to Worker collector

Gateway operator source: `sdk/scripts/gateway-operator.mjs`.

Required environment variable names:

```text
PACKAGE_ID
GATEWAY_WEBHOOK_URL
GATEWAY_PRIVATE_KEY
```

Optional environment variable names:

```text
SHOWCASE_MANIFEST
GATEWAY_STORE_PATH
SUI_RPC_URL
GATEWAY_INTERVAL_MS
GATEWAY_BUFFER_LOW_THRESHOLD
```

Runtime behavior:

- Reads active paycards from `scripts/openrails-v1-1-showcase.manifest.json` by default.
- Uses an Ed25519 Sui private key to sign gateway events. Never print or save this key.
- Prints gateway public key hex, which must match Worker secret `GATEWAY_PUBLIC_KEY_HEX`.
- Persists gateway state to `scripts/openrails-v1-1-gateway-state.json` by default. Do not commit.

### Resolver Worker

Operational facts:

| Item | Value |
| --- | --- |
| Worker name | `openrails-resolver` |
| Directory | `services/resolver` |
| Entrypoint | `services/resolver/src/handler.ts` |
| Local server | `services/resolver/src/server.ts` |
| Local default port | `8787` |
| Build | `npm --prefix services/resolver run build` |
| Deploy | `npm --prefix services/resolver run deploy` |
| Route | `GET /v1/:blobId?network=testnet\|mainnet` |
| Testnet upstream | `https://aggregator.walrus-testnet.walrus.space` |
| Mainnet upstream | `https://aggregator.walrus.space` |
| Secrets | none required by current repo config |

Resolver behavior:

- Fetches Walrus blob content from the selected public aggregator.
- Accepts plain or AES-256-GCM encrypted OpenRails envelopes.
- Returns JSON with permissive CORS if content validates.
- Returns `404` for missing/expired blobs, `422` for invalid JSON, `400` for non-OpenRails content.

### Web server (apps/web)

Operational facts:

| Item | Value |
| --- | --- |
| Framework | Vite 6.0.0 + React 19 + TypeScript 5.7 |
| Branch | `console-app` |
| Dev server | `npm --prefix apps/web run dev` → `http://localhost:5173` |
| Typecheck | `npm --prefix apps/web run typecheck` |
| Production build | `npm --prefix apps/web run build` → `apps/web/dist` |
| Preview built output | `npm --prefix apps/web run preview` |
| Local SDK link | `@openrails/sdk` → `file:../../sdk` (build SDK first; reinstall after each SDK change) |
| API default | `https://openrails-receipt-api.microcosm.workers.dev` |

Environment variables (all `VITE_` prefixed, read via `import.meta.env`):

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `VITE_SUI_NETWORK` | no | `testnet` | `testnet` or `mainnet`. Controls initial network for SuiClientProvider. |
| `VITE_OPENRAILS_PACKAGE_ID` | for writes | `0x4a42fd84…` (V1.2) | Published 2026-06-21. Set in `apps/web/.env.local` and Cloudflare Pages env. |
| `VITE_OPENRAILS_API_BASE_URL` | no | Worker default URL | Override to point at a local Worker dev server. |
| `VITE_ENOKI_API_KEY` | for zkLogin | — | Enoki project public API key. Never commit. |
| `VITE_GOOGLE_CLIENT_ID` | for Google zkLogin | — | OAuth 2.0 client ID. Never commit. |
| `VITE_ENOKI_FACEBOOK_CLIENT_ID` | for FB zkLogin | — | Never commit. |
| `VITE_ENOKI_TWITCH_CLIENT_ID` | for Twitch zkLogin | — | Never commit. |

Wallet setup notes:

- `ENOKI_ENABLED` is computed at runtime as `true` when `VITE_ENOKI_API_KEY` + at least one OAuth client ID is present. If absent, zkLogin options are hidden; standard Sui wallet connect still works.
- `ENOKI_REDIRECT_URL` is `window.location.origin` — no extra config needed.
- For Google zkLogin: in Google Cloud Console, create an OAuth 2.0 client (Web application), add `http://localhost:5173` (and the production origin) to Authorized JavaScript Origins. No server-side redirect needed.
- For Enoki sponsorship: allowlist the move-call targets in the Enoki developer portal: `mint_and_fund_envelope`, `claim_settlement_round`, `cancel_paycard`, `resolve_residual_delta_expiry`, `create_nonce_account`.
- Full operator setup guide: `apps/web/WALLET_E2E.md`.

Local dev quick start:

```bash
cp apps/web/.env.example apps/web/.env.local   # fill in secrets
npm --prefix sdk run build
npm --prefix apps/web install
npm --prefix apps/web run dev                   # → http://localhost:5173
```

After any SDK source change:

```bash
npm --prefix sdk run build
rm -rf apps/web/node_modules/@openrails/sdk
npm --prefix apps/web install
```

Web hosting (Cloudflare Pages):

```text
Cloudflare Pages project name: openrails-console
Production web URL: https://openrails-console.pages.dev/
Current deploy: https://dd546109.openrails-console.pages.dev
Build command: npm run build
Build output directory: dist
Build environment variables: VITE_OPENRAILS_PACKAGE_ID, VITE_ENOKI_API_KEY, etc.
Deployed: 2026-06-21
```

### Post-deploy smoke checks

Use these checks after Worker or web deployment:

```bash
curl -fsS https://openrails-receipt-api.microcosm.workers.dev/health
curl -fsS https://openrails-receipt-api.microcosm.workers.dev/v1/receipts
curl -fsS "https://openrails-receipt-api.microcosm.workers.dev/v1/proofs/0x1809f38156fb5f2724708523ebcce13f04c8bda613c9e9b87ed8ace9b632e627"
npm --prefix sdk test
npm --prefix services/receipt-api test
npm --prefix apps/web run typecheck
npm --prefix apps/web run build
```

If web hosting is deployed, also verify:

- console app loads (no landing page — boots directly to ConsoleShell),
- Overview, Rails, Receipts, Proof panels load data,
- proof center returns testnet evidence links,
- explorer links point to Sui testnet,
- network chip shows correct network,
- Connect button opens wallet / zkLogin options.

### Rollback notes

- Worker rollback: deploy previous Worker version or revert receipt API commit group and redeploy.
- D1 rollback: preserve data when possible; schema is additive in V1.1. Do not drop tables without explicit approval.
- Gateway rollback: stop gateway operator or point it to a safe webhook. Do not rotate keys without updating Worker `GATEWAY_PUBLIC_KEY_HEX`.
- Web rollback: redeploy previous static build or revert web commit group.
- Protocol rollback after package publish is limited — Sui package IDs and emitted events are immutable.

## Last validation run

The following passed during V1.2 implementation:

```bash
sui move test --path move
npm --prefix sdk test
npm --prefix services/receipt-api test
npm --prefix apps/web run typecheck
npm --prefix apps/web run build
git diff --check
```

Additional checks passed:

- SDK subpath import smoke for root, `/browser`, `/worker`, and `/api`.
- CLI smoke: `sdk/dist/cli.js --help`.
- Live CLI health: `sdk/dist/cli.js health`.
- SDK package dry-run: only `package.json` and `dist/**`, with executable CLI mode.
- High-confidence secret scan found only placeholder or environment variable references.

Move tests passed with deprecated `vector::empty` warnings only.

## Known gaps

1. **V1.2 Move package: published.** Package `0x4a42fd8493d0929879b2cbd4e19226468867f2c4a4dece8a59d317911d172b2c` is live on testnet. `wrangler.toml` and `config.ts` updated. **Pending: redeploy Worker** (`npm --prefix services/receipt-api run deploy`) to start indexing V1.2 receipts. Requires `wrangler login` first.
2. **Live e2e writes: ready once Worker is redeployed.** `useChannelWrite` is fully wired to V1.2 package. Open the local dev server and connect a Sui wallet to open channels now.
3. **Console tailoring plan (Parts A–E): pending.** Plan saved at `/home/jay/.claude/plans/the-frontend-is-the-typed-narwhal.md`:
   - A: Human units — SUI/sec instead of MIST/sec, stablecoin asset selector (DBUSDC testnet / USDC mainnet).
   - B: Automatic network switching — wallet chain auto-syncs the app network; sidebar network switcher.
   - C: RailsCard (sealed vault) open in the browser via ephemeral keypair + bearer link.
   - D: Shareable link + QR per paycard type (`qrcode.react`).
   - E: Animated stream meter — ticking accrual value, flowing progress bar, countdown.
4. **Access credential: browser issuing pending.** CLI `credential issue` works. Browser path (personal-message signing via wallet) is on roadmap. `ChannelMetadataAnchored` indexing (for `metadataHash` cross-check in credential verify) also pending.
5. **Product receipt: export layer pending.** SDK layer done (`product-receipt.ts`). Worker `/v1/product-receipts/:paycardId` route, PDF/QR merchant export, and `ChannelMetadataAnchored` event indexing pending.
6. **V2 Vault/Conduit/DOF: design locked, not built.** See `docs/architecture/v2-blueprint.md`.
7. **`uiland/**` remains untracked and intentionally excluded.**

## Immediate next options

1. Publish V1.2 package (operator) + update package IDs across Worker and web.
2. Run live e2e from the browser (`apps/web/WALLET_E2E.md`) after publish.
3. Implement Console tailoring plan Parts A–E (human units, network switch, RailsCard, QR, meter).
4. Index `ChannelMetadataAnchored` event in Worker + product receipt route.
5. Start V2 Vault/Conduit/DOF build.

Recommended sequence:

```text
publish V1.2 → live e2e smoke → tailoring plan A-B → C-E → product receipt → V2
```

## Handoff update protocol

Update this file:

- after every implementation session,
- before and after each release cut,
- after every deploy,
- after any protocol, API, indexer, SDK, CLI, or frontend behavior change,
- after validation status changes.

Each update should include:

1. latest commit/tag/deploy state,
2. what changed,
3. validation commands and results,
4. known gaps,
5. next planned work,
6. risks and required decisions.

Never include:

- private keys,
- seed phrases,
- bearer tokens,
- raw secret environment values,
- local-only key exports,
- unredacted production credentials.

## Commit and staging hygiene

Exclude from staging unless explicitly requested:

```text
uiland/**
node_modules/**
dist/**
move/build/**
*:Zone.Identifier
scripts/openrails-v1-1-gateway-state.json
```

Current `.gitignore` includes `*:Zone.Identifier` to prevent accidental Windows metadata commits.
