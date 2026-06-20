#!/usr/bin/env bash
#
# publish-v1-2.sh — publish the OpenRails V1.2 Move package to Sui testnet.
#
# This is an OPERATOR step: it spends gas from your active Sui CLI address and
# cuts a NEW package (V1.2). The deployed V1.1 package stays live and provable;
# nothing here touches it.
#
# Prerequisites:
#   - sui CLI installed and an active testnet env with a funded address
#       sui client active-address
#       sui client active-env        # should be testnet
#       sui client faucet            # if you need gas
#   - `cd move && sui move test` is green (run it first).
#
# After publishing you MUST repoint the off-chain layers to the new package ID
# (this is Phase 2 — SDK/CLI/web/worker do NOT yet match the V1.2 ABI):
#   - services/receipt-api/wrangler.toml   (package id + indexer event filter)
#   - apps/web/src/services/openrailsApi.ts (package id)
#   - sdk/src/network.ts / call sites       (package id + new entry params,
#                                            buildVaultMessage, NonceEngine)
#
# No secrets are read or written by this script.

set -euo pipefail

MOVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../move" && pwd)"
GAS_BUDGET="${GAS_BUDGET:-200000000}"

echo "OpenRails V1.2 publish"
echo "  package dir : ${MOVE_DIR}"
echo "  active addr : $(sui client active-address)"
echo "  active env  : $(sui client active-env)"
echo "  gas budget  : ${GAS_BUDGET}"
echo

echo "==> Running Move tests before publish"
( cd "${MOVE_DIR}" && sui move test )

echo
echo "==> Publishing (records package ID + UpgradeCap in the output below)"
sui client publish --gas-budget "${GAS_BUDGET}" "${MOVE_DIR}"

echo
echo "Done. Copy the new packageId from the 'Published Objects' section above and"
echo "repoint the off-chain layers (see header notes) as part of Phase 2."
