import { Transaction } from "@mysten/sui/transactions";
import type {
  MintParams,
  ClaimParams,
  ClaimAndSwapParams,
  ResolveParams,
  CancelParams,
  CreateVaultParams,
  UnsealVaultParams,
} from "./types.js";

export const SUI_CLOCK_OBJECT_ID = "0x6";

/**
 * Builds a PTB that mints and funds a Paycard envelope (RailsCard).
 * Passes the original coin object directly — Move splits the allocation internally,
 * leaving the remainder in the payer's coin (no dangling zero-balance objects).
 * If blobId is provided, it is anchored at mint time within the same transaction.
 */
export function buildMintPTB(params: MintParams): Transaction {
  const tx = new Transaction();

  // Funding source. By default the payer's coin object is passed directly and
  // Move splits the allocation, leaving the remainder in that coin. With
  // `fundFromGas`, the allocation is split off the gas coin instead — so a payer
  // holding a single SUI coin can both fund and pay gas; the emptied split coin
  // is returned to the sender (Move borrows it `&mut`, so it must be consumed).
  if (params.fundFromGas) {
    if (!params.sender) throw new Error("fundFromGas requires `sender`.");
    const [funding] = tx.splitCoins(tx.gas, [tx.pure.u64(params.totalProvisionAmount)]);
    tx.moveCall({
      target: `${params.packageId}::paycard_v1::mint_and_fund_envelope`,
      typeArguments: [params.typeArgument],
      arguments: [
        funding,
        tx.pure.u64(params.totalProvisionAmount),
        tx.pure.u64(params.maxFlowRatePerSecond),
        tx.pure.address(params.recipient),
        tx.pure.u64(params.startTimestamp),
        tx.pure.u64(params.durationSeconds),
        tx.pure.address(params.recoveryTarget),
        tx.pure.vector("u8", params.blobId ? Array.from(params.blobId) : []),
        tx.object(params.nonceAccountObjectId),
        tx.pure.u64(params.nonceChannel),
        tx.pure.u64(params.nonceValue),
        tx.pure.vector("u8", params.metadataHash ? Array.from(params.metadataHash) : []),
      ],
    });
    tx.transferObjects([funding], tx.pure.address(params.sender));
    return tx;
  }

  tx.moveCall({
    target: `${params.packageId}::paycard_v1::mint_and_fund_envelope`,
    typeArguments: [params.typeArgument],
    arguments: [
      tx.object(params.coinObjectId),
      tx.pure.u64(params.totalProvisionAmount),
      tx.pure.u64(params.maxFlowRatePerSecond),
      tx.pure.address(params.recipient),
      tx.pure.u64(params.startTimestamp),
      tx.pure.u64(params.durationSeconds),
      tx.pure.address(params.recoveryTarget),
      tx.pure.vector("u8", params.blobId ? Array.from(params.blobId) : []),
      tx.object(params.nonceAccountObjectId),
      tx.pure.u64(params.nonceChannel),
      tx.pure.u64(params.nonceValue),
      tx.pure.vector("u8", params.metadataHash ? Array.from(params.metadataHash) : []),
    ],
  });

  return tx;
}

/**
 * Builds a PTB that creates the caller's shared NonceAccount (V1.2).
 * One per payer; reused across every channel open. The created object ID is read
 * from the transaction's created-objects in effects.
 */
export function buildCreateNonceAccountPTB(packageId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: `${packageId}::nonce_account::create_nonce_account`, arguments: [] });
  return tx;
}

/**
 * Builds a PTB that executes a settlement claim round and transfers the accrued
 * balance directly to the recipient. Simple path — no swap.
 */
export function buildClaimPTB(params: ClaimParams): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${params.packageId}::paycard_v1::claim_settlement_round`,
    typeArguments: [params.typeArgument],
    arguments: [
      tx.object(params.paycardObjectId),
      tx.object(params.clockObjectId ?? SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

/**
 * Builds a PTB that claims settlement and swaps the proceeds through DeepBook V3
 * inline — base token → merchant's preferred quote token — in one atomic block.
 *
 * Composition (all in a single PTB, coins threaded between packages):
 *   1. open_rails::paycard_v1::execute_claim_round  → Coin<Base>
 *   2. deepbook::pool::swap_exact_base_for_quote    → (Coin<Base>, Coin<Quote>, Coin<DEEP>)
 *   3. quote → recipient; base + DEEP remainders → sender
 *
 * The OpenRails Move package carries NO DeepBook dependency — the published
 * DeepBook pool function is composed directly at the transaction layer.
 *
 * DEEP fee: whitelisted (stablecoin) pools charge zero DEEP, so when
 * deepCoinObjectId is omitted a zero-value DEEP coin is minted in-PTB via
 * 0x2::coin::zero. Non-whitelisted pools require a real DEEP coin object.
 */
export function buildClaimAndSwapPTB(params: ClaimAndSwapParams): Transaction {
  const tx = new Transaction();
  const clock = tx.object(params.clockObjectId ?? SUI_CLOCK_OBJECT_ID);

  // 1. Claim accrued base coin from the Paycard (non-entry → returns Coin<Base>)
  const [baseCoin] = tx.moveCall({
    target: `${params.packageId}::paycard_v1::execute_claim_round`,
    typeArguments: [params.baseTypeArgument],
    arguments: [tx.object(params.paycardObjectId), clock],
  });

  // 2. DEEP fee coin: supplied object, or a zero coin for whitelisted pools
  const deepCoin = params.deepCoinObjectId
    ? tx.object(params.deepCoinObjectId)
    : tx.moveCall({
        target: "0x2::coin::zero",
        typeArguments: [params.deepTypeArgument],
        arguments: [],
      });

  // 3. Swap base → quote directly through DeepBook V3's published pool
  //    Returns (base remainder, quote out, DEEP remainder)
  const [baseRemainder, quoteOut, deepRemainder] = tx.moveCall({
    target: `${params.deepbookPackageId}::pool::swap_exact_base_for_quote`,
    typeArguments: [params.baseTypeArgument, params.quoteTypeArgument],
    arguments: [
      tx.object(params.poolObjectId),
      baseCoin,
      deepCoin,
      tx.pure.u64(params.minQuoteOut),
      clock,
    ],
  });

  // 4. Deliver quote to recipient; return base + DEEP remainders to sender
  tx.transferObjects([quoteOut], tx.pure.address(params.recipient));
  tx.transferObjects([baseRemainder, deepRemainder], tx.pure.address(params.senderAddress));

  return tx;
}

/**
 * Builds a PTB that resolves expiry and sweeps the STN-Delta residual to the recovery vault.
 */
export function buildResolvePTB(params: ResolveParams): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${params.packageId}::paycard_v1::resolve_residual_delta_expiry`,
    typeArguments: [params.typeArgument],
    arguments: [
      tx.object(params.paycardObjectId),
      tx.object(params.clockObjectId ?? SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

// ─── SealedVault (RailsCard) PTB builders ────────────────────────────────────

/**
 * Builds a PTB that creates a SealedVault (RailsCard outbound flow).
 * The vault becomes a shared object. Payer signs vault params off-chain
 * (via signVaultEd25519) and passes the token to the recipient.
 *
 * Tier-2 gas reserve: gasAmount (SUI base units) is split from gasCoinObjectId
 * and dispensed to the recipient at unseal. Pass gasAmount = 0 to disable.
 * When typeArgument is SUI, gasCoinObjectId MUST be a different coin object than
 * coinObjectId — a single object cannot be borrowed mutably twice in one PTB.
 *
 * startTimestamp = 0  → stream starts when recipient unseals (dynamic)
 * startTimestamp > 0  → stream starts at payer-encoded Unix timestamp (fixed)
 */
export function buildCreateVaultPTB(params: CreateVaultParams): Transaction {
  const tx = new Transaction();

  const pubkeyBytes = hexToBytes(params.payerPubkeyHex);

  tx.moveCall({
    target: `${params.packageId}::sealed_vault::create_sealed_vault`,
    typeArguments: [params.typeArgument],
    arguments: [
      tx.object(params.coinObjectId),
      tx.pure.u64(params.allocationAmount),
      tx.object(params.gasCoinObjectId),
      tx.pure.u64(params.gasAmount),
      tx.pure.vector("u8", Array.from(pubkeyBytes)),
      tx.pure.u64(params.maxFlowRatePerSecond),
      tx.pure.u64(params.durationSeconds),
      tx.pure.u64(params.startTimestamp),
      tx.pure.address(params.recoveryTarget),
      tx.pure.u64(params.nonce),
      tx.pure.u8(params.curve),
      tx.object(params.nonceAccountObjectId),
      tx.pure.u64(params.nonceChannel),
      tx.pure.vector("u8", params.metadataHash ? Array.from(params.metadataHash) : []),
    ],
  });

  return tx;
}

/**
 * Builds a PTB that verifies the payer's signature on-chain and mints a Paycard
 * to the recipient — completing the RailsCard claim flow.
 */
export function buildUnsealVaultPTB(params: UnsealVaultParams): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${params.packageId}::sealed_vault::unseal_and_mint`,
    typeArguments: [params.typeArgument],
    arguments: [
      tx.object(params.vaultObjectId),
      tx.pure.vector("u8", Array.from(params.signature)),
      tx.pure.address(params.recipient),
      tx.pure.vector("u8", params.blobId ? Array.from(params.blobId) : []),
      tx.object(params.clockObjectId ?? SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

/**
 * Builds a PTB that cancels an unclaimed SealedVault and refunds the payer.
 */
export function buildCancelVaultPTB(
  packageId: string,
  vaultObjectId: string,
  typeArgument: string
): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${packageId}::sealed_vault::cancel_vault`,
    typeArguments: [typeArgument],
    arguments: [tx.object(vaultObjectId)],
  });

  return tx;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return new Uint8Array(clean.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
}

// ─── Paycard PTB builders ─────────────────────────────────────────────────────

/**
 * Builds a PTB that cancels a Paycard and returns the full remaining allocation to the payer.
 * Passes the shared Clock object so the contract records an accurate closed_at_seconds
 * in the emitted SettlementReceipt.
 */
export function buildCancelPTB(params: CancelParams): Transaction {
  const tx = new Transaction();

  tx.moveCall({
    target: `${params.packageId}::paycard_v1::cancel_paycard`,
    typeArguments: [params.typeArgument],
    arguments: [
      tx.object(params.paycardObjectId),
      tx.object(params.clockObjectId ?? SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}
