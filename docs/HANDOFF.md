# OpenRails Handoff

Last updated: 2026-06-20 (V1.2 nonce-lane on-chain foundation + V2 spec lock)

## Current release state

OpenRails V1.1 is committed locally and tagged as `v1.1.0-testnet`. The tag points at:

```text
cae801a Harden release staging hygiene
```

Recent local commits:

```text
fc2155c Add V1.1 channel settlement semantics
5309db8 Add V1.1 SDK API and CLI surface
e38e07a Add durable receipt API projections
7817282 Add real-data OpenRails web dashboard
867bcc0 Record V1.1 testnet showcase proof
cae801a Harden release staging hygiene
```

These commits have not been pushed in this handoff.

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

- `sdk/src/api.ts`
  - Typed public Worker API client.
- `sdk/src/proof.ts`
  - Public proof object builder and trust boundary labels.
- `sdk/src/browser.ts`, `sdk/src/worker.ts`
  - Browser and Worker safe entrypoints.
- `sdk/src/cli.ts`
  - Public `openrails` CLI.
- `sdk/package.json`
  - Export map for root, `/browser`, `/worker`, `/api`.
  - `bin.openrails` points at `dist/cli.js`.
  - `files` allowlist limits package contents to `dist/`.
- `sdk/scripts/*showcase*.mjs`, `sdk/scripts/gateway-operator.mjs`
  - Testnet seeding, verifying, and gateway operation scripts.

### Receipt API and gateway projection

- `services/receipt-api/src/handler.ts`
  - Public read routes for receipts, streams, and proofs.
  - Signed gateway event collector.
  - Admin receipt indexer trigger.
- `services/receipt-api/src/storage.ts`
  - D1 and in-memory receipt/gateway projection storage.
- `services/receipt-api/src/indexer.ts`
  - Cursor-based SettlementReceipt event indexer.
- `services/receipt-api/migrations/0001_receipt_storage.sql`
  - D1 schema for gateway events, paycard states, settlement receipts, and indexer state.
- `services/receipt-api/wrangler.toml`
  - V1.1 package configuration and scheduled indexer.

### Receipts and proof layer

- V1.1 has an authoritative onchain `SettlementReceipt` event.
- The SDK parses and normalizes settlement receipts as `SettlementReceiptV1` and `IndexedSettlementReceiptV1`.
- The Worker indexes terminal settlement receipts and exposes receipt/proof routes.
- The dashboard displays receipt records and explorer links.
- Gateway events are signed offchain projections, not authoritative settlement receipts.

### Web app

- `apps/web/**`
  - Read-only live dashboard.
  - Consumes deployed Worker data.
  - Shows package, paycard, receipt, stream, proof, and gateway projection boundaries.
  - Does not connect wallets or submit transactions.

#### Frontend redesign (2026-06-20 session)

- The web frontend was rebuilt on the faithful light "Stream" design language.
  - `apps/web/src/stream.css` is the single authoritative stylesheet, imported by `apps/web/src/main.tsx`. `styles.css` and `redesign.css` remain on disk but are unimported and kept only for reference/rollback.
  - Typography: Instrument Serif (display) + Hanken Grotesk (body) + JetBrains Mono (mono), loaded via Google Fonts in `apps/web/index.html`. Warm light palette, SVG wave textures, rounded paper cards.
- Landing (`apps/web/src/components/LandingPage.tsx`) is a marketing page: sticky navbar (blur on scroll) + mobile sheet, hero with a live accrual flowcard, i–v protocol ribbon, primitives, an honest "what's real / simulated / projection" trust block, machine-economy use cases, real testnet proof links, CTA band, and a multi-column footer (real explorer/Worker links only). Sections fade in on scroll (IntersectionObserver), reduced-motion guarded.
- Dashboard chrome reskinned with a **collapsible sidebar**: smooth icon-rail collapse on desktop and an off-canvas drawer on mobile (`DashboardSidebar.tsx`, `DashboardTopbar.tsx` hamburger, `DashboardShell.tsx` collapse class + scrim). Streams render as Stream `.rail` rows and receipts as `.rcard` rows.
- New clickable detail interaction: stream and receipt rows open an inspect modal (`apps/web/src/components/dashboard/InspectModal.tsx`) showing a live stream-hero, STN-Delta breakdown, proof trail, channel terms, encrypted link, and a JSON payload viewer (`apps/web/src/components/dashboard/JsonBlock.tsx`) with an explorer link. Keyboard nav: `1/2/3` switch routes, `⌘K` focuses search, `Esc` closes modals.
- Data layer additions are additive and presentation-only: `inspect` state + `open-inspect`/`close-inspect` actions in `types/dashboard.ts` and `hooks/useMockDashboard.ts`; enriched receipt fields (payer, recipient, allocation, mist values, tx digest, explorer href) in `data/showcase.ts` and `data/mock.ts`.
- Still strictly read-only: no wallet connect, signature, Sui write, or Walrus upload. The V1.2 roadmap (Nonce Lanes, Write Access, Access Credentials) is signaled as locked sidebar nav items.
- Validation: `npm --prefix apps/web run typecheck` passed; `npm --prefix apps/web run build` passed.

### Testnet proof artifact

- `scripts/openrails-v1-1-showcase.manifest.json`
  - Public testnet package, flow, receipt, and transaction proof metadata.
  - No private keys or secrets should be stored here.

## Cloudflare and hosting operations

This section is for the next agent taking over deployment, operations, or incident response. It records repo-known facts only. Unknown Cloudflare account, dashboard, project, custom domain, and secret values must be filled in after operator verification.

### Source-of-truth matrix

| Surface | Source file | Current repo-known fact |
| --- | --- | --- |
| Receipt API Worker | `services/receipt-api/wrangler.toml` | Worker name `openrails-receipt-api`, entrypoint `src/handler.ts`, compatibility date `2026-06-18`. |
| Receipt API public base | `sdk/src/cli.ts`, `apps/web/src/services/openrailsApi.ts` | Default URL `https://openrails-receipt-api.microcosm.workers.dev`. |
| Receipt API package ID | `services/receipt-api/wrangler.toml`, web API client, showcase manifest | V1.1 package `0x7cb4ca17166b7999223d665db2e43991288b1fd8466b930e4c2a345e847aaf55`. |
| Move generated publish metadata | `move/Published.toml` | Older generated testnet package `0xfaf26d6a2028446fa61f4171c27f26209dc7951ea8634dc8ce88e1fa125dacf1`. Do not treat this as the V1.1 public cut without reconciling. |
| Resolver Worker | `services/resolver/wrangler.toml` | Worker name `openrails-resolver`, entrypoint `src/handler.ts`, compatibility date `2024-01-01`. |
| Web app | `apps/web/package.json`, `apps/web/src/services/openrailsApi.ts` | Vite React app under `apps/web`, read-only, default API points to receipt Worker. |
| SDK CLI | `sdk/package.json`, `sdk/src/cli.ts` | `openrails` bin, read-only receipt/stream/proof/health commands. |

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
| OpenRails package | `0x7cb4ca17166b7999223d665db2e43991288b1fd8466b930e4c2a345e847aaf55` |
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
| `GET` | `/health` | none | none | Returns `{ "ok": true }`; does not require package config. |
| `GET` | `/v1/receipts` | none | optional | Lists indexed settlement receipts from D1 when configured, otherwise falls back to live Sui event queries. Query params: `limit`, `order`, `cursorTxDigest`, `cursorEventSeq`, `paycardId`, `payer`, `recipient`, `settlementType`. |
| `GET` | `/v1/receipts/:paycardId` | none | optional | Returns terminal receipt for a paycard or `receipt_not_found`. Query params: `limit`, `maxPages`. |
| `GET` | `/v1/streams/:paycardId` | none | required | Returns latest signed gateway projection state or `stream_not_found`. |
| `GET` | `/v1/streams/:paycardId/events` | none | required | Lists signed gateway events. Query params: `limit`, `cursor`. |
| `GET` | `/v1/proofs/:paycardId` | none | optional | Joins latest stream state, recent gateway events, terminal receipt, explorer links, and trust boundaries. |
| `POST` | `/v1/gateway/events` | gateway signature | required | Verifies signed gateway event with `GATEWAY_PUBLIC_KEY_HEX`, stores idempotently by `eventId`, updates paycard projection if newer. |
| `POST` | `/admin/index/receipts/run` | `ADMIN_TOKEN` | required | Runs receipt indexer manually. Token accepted through `Authorization` bearer form or `X-Admin-Token`. |

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
- Order: ascending.
- Page limit: `50`.
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
- Starts SDK `startGateway`.
- Posts signed events to `GATEWAY_WEBHOOK_URL`, normally the Worker route `/v1/gateway/events`.
- Prints gateway public key hex, which must match Worker secret `GATEWAY_PUBLIC_KEY_HEX`.
- Persists gateway state to `scripts/openrails-v1-1-gateway-state.json` by default.
- Default polling interval is `10_000` milliseconds.

Do not commit generated gateway state unless an operator explicitly decides it is public and useful. Treat it as operational state.

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
- Accepts plain OpenRails envelopes with `envelope` and `intent` objects.
- Accepts encrypted OpenRails envelopes with AES-256-GCM fragment-key schema.
- Returns JSON with permissive CORS if content validates.
- Returns `404` for missing/expired blobs, `422` for invalid JSON, and `400` for non-OpenRails content.

### Web hosting state

Repo-known facts:

| Item | Value |
| --- | --- |
| App directory | `apps/web` |
| Framework | Vite + React |
| Typecheck | `npm --prefix apps/web run typecheck` |
| Build | `npm --prefix apps/web run build` |
| Output directory | `apps/web/dist` |
| Default API base | `https://openrails-receipt-api.microcosm.workers.dev` |
| API override | `VITE_OPENRAILS_API_BASE_URL` |
| Product mode | read-only proof/dashboard surface |

Unknown from repo, fill after deploy:

```text
Cloudflare Pages project name: <unknown>
Production web URL: <unknown>
Preview URL pattern: <unknown>
Custom domain: <unknown>
Build environment variables: <unknown except VITE_OPENRAILS_API_BASE_URL if set>
Cache/header policy: <unknown>
```

The current web app does not connect wallets, request signatures, or submit transactions. It consumes the Worker API and displays proof, receipt, stream, and gateway projection state.

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

- landing page loads,
- dashboard route loads,
- proof center returns data,
- explorer links point to Sui testnet,
- API base URL is the intended Worker URL,
- no wallet/write affordance implies production write support.

### Rollback notes

- Worker rollback: deploy previous Worker version or revert receipt API commit group and redeploy.
- D1 rollback: preserve data when possible; schema is additive in V1.1. Do not drop tables without explicit approval.
- Gateway rollback: stop gateway operator or point it to a safe webhook. Do not rotate keys without updating Worker `GATEWAY_PUBLIC_KEY_HEX`.
- Web rollback: redeploy previous static build or revert web commit group.
- Protocol rollback after package publish is limited because Sui package IDs and emitted events are immutable.

## Last validation run

The following passed during release hardening:

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

1. Nonce Lane architecture: **on-chain layer implemented (V1.2), off-chain pending.**
   - DONE (branch `v1-2-nonce-lanes`, `sui move test` green, NOT published): `move/sources/nonce_account.move` — per-payer `NonceAccount { payer, lanes: Table<nonce_channel, next_nonce_value> }` with `create_nonce_account` / `verify_and_consume` / `next_nonce`. Lane consumption wired into `mint_and_fund_envelope` (RailsFlow) and `create_sealed_vault` (RailsCard); `payer = sender`, atomic (replay/stale value aborts the whole tx). `metadata_hash` bound into `Paycard`/`SealedVault` + the vault signature message + `ChannelMetadataAnchored` event. `PROTOCOL_VERSION = 12`.
   - PENDING (Phase 2): SDK `NonceEngine`, SDK `buildVaultMessage` + entry-param updates to the new ABI, then publish the V1.2 package and repoint receipt-api / web / sdk package IDs.
2. Public writes: **CLI + web implemented (V1.2), live e2e pending publish.**
   - CLI: `openrails nonce-create/open/open-vault/unseal/claim/cancel/resolve` (branch `v1-2-nonce-lanes`).
   - Web (consolidated on `console-app`): @mysten/dapp-kit + @mysten/enoki (Google/Facebook/Twitch zkLogin + sponsored gas), `useChannelWrite` write-state machine, "Open a rail" surface (open/claim/cancel/resolve). Pins: dapp-kit 0.20.0 + enoki 0.11.0 (sui v1.x, matching the SDK); Vite `dedupe` collapses @mysten/sui copies.
   - PENDING (operator): publish V1.2, set `VITE_OPENRAILS_PACKAGE_ID` + Enoki/Google secrets (`apps/web/.env.local` from `.env.example`), run the live e2e per `apps/web/WALLET_E2E.md`. RailsCard vault open/unseal is CLI-only in the web for now.
3. Access credentials: **implemented (V1.2).**
   - SDK `access-credential.ts` — payer-signed `AccessCredentialV1` (merchant co-sign optional), `Authorization: OpenRails` header helpers, `verifyAccessCredentialSignature` + `verifyAccessCredential` (sig → payer-address match → expiry → channel active via `channel-state.ts` `getChannelState` or the proof API). Worker `POST /v1/access/verify`; CLI `credential issue`/`verify`. sdk 25/25, worker 25/25.
   - PENDING: on-chain `metadataHash` cross-check (needs `ChannelMetadataAnchored` indexing), credential revocation, browser credential issuing (personal-message signing), a demo gated-resource/middleware example.
4. The formal product Receipt Layer: **SDK layer implemented (V1.2).**
   - DONE: canonical `metadata_hash` bound on-chain at mint; SDK `product-receipt.ts` (`computeMetadataHash`/`metadataHashHex`/`verifyMetadataHash` + `createPaymentReceipt`/`createSettlementReceipt`/`createResidualRecoveryReceipt`, `ProductReceiptV1` schema, deterministic `receiptId`); Worker `GET /v1/nonces/:nonceAccountId/:lane`.
   - PENDING: PDF/QR/merchant export, a Worker `/v1/product-receipts/:paycardId` route (needs off-chain metadata sourcing), `ChannelMetadataAnchored` indexing to expose `metadata_hash` in proofs, the by-`:payer` nonce form (needs a `NonceAccountCreated` Move event), and access-credential binding to product receipt id + metadata hash.
   - Existing receipts still primarily mean terminal onchain `SettlementReceipt` records.
5. V2 Vault, Conduit, and DOF architecture: **design locked** (`docs/architecture/v2-blueprint.md` — DOF = Sui Dynamic Object Fields, object model + ABI sketch + migration). Not yet built.
6. `uiland/**` remains untracked and intentionally excluded.

## Immediate next options

1. Push and deploy V1.1 read/proof cut.
2. Implement V1.2 nonce lanes and public write foundations.
3. Add the V1.2 Receipt Layer, including canonical metadata hash, product receipt schema, and access credential binding.
4. Produce V2 Vault/Conduit/DOF design before more code.

Recommended sequence:

```text
Push and deploy V1.1 -> implement V1.2 nonce/write/receipt foundations -> start V2
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
```

Current `.gitignore` includes `*:Zone.Identifier` to prevent accidental Windows metadata commits.
