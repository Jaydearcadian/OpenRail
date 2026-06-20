import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";

/** Curve identifiers — match sealed_vault.move CURVE_* constants */
export const CURVE_ED25519    = 0;
export const CURVE_SECP256K1  = 1;

/** Sentinel: pass as startTimestamp to start the stream when the recipient unseals */
export const START_DYNAMIC = 0;

export interface VaultParams {
  payerPubkey: Uint8Array;
  allocationAmount: bigint;
  /** Tier-2 gas reserve dispensed to the recipient at unseal (SUI base units). 0 disables. */
  gasAmount: bigint;
  maxFlowRatePerSecond: bigint;
  durationSeconds: number;
  /** 0 = dynamic (clock at unseal); non-zero = payer-fixed Unix seconds */
  startTimestamp: number;
  recoveryTarget: string;
  nonce: bigint;
  /** CURVE_ED25519 (0) or CURVE_SECP256K1 (1) — must match the vault's stored curve */
  curve: number;
  /** V1.2: payer nonce lane this open advances (covered by the signature) */
  nonceChannel: bigint;
  /** V1.2: canonical product/invoice terms hash, raw bytes (empty = none) */
  metadataHash: Uint8Array;
}

/**
 * Builds the canonical message bytes that the payer signs for a SealedVault.
 * Must match sealed_vault::build_vault_message() exactly.
 *
 * Format (all integers are BCS little-endian u64):
 *   payer_pubkey (32 or 33 bytes depending on curve)
 *   || allocation_amount (8 bytes)
 *   || gas_amount (8 bytes)
 *   || max_flow_rate_per_second (8 bytes)
 *   || duration_seconds (8 bytes)
 *   || start_timestamp (8 bytes)
 *   || recovery_target (32 bytes, raw address bytes)
 *   || nonce (8 bytes)
 *   || curve (1 byte)
 *   || nonce_channel (8 bytes)        [V1.2]
 *   || metadata_hash (raw bytes)      [V1.2, empty = none]
 */
export function buildVaultMessage(params: VaultParams): Uint8Array {
  const chunks: Uint8Array[] = [
    params.payerPubkey,
    bcs.u64().serialize(params.allocationAmount).toBytes(),
    bcs.u64().serialize(params.gasAmount).toBytes(),
    bcs.u64().serialize(params.maxFlowRatePerSecond).toBytes(),
    bcs.u64().serialize(params.durationSeconds).toBytes(),
    bcs.u64().serialize(params.startTimestamp).toBytes(),
    hexToBytes(params.recoveryTarget),
    bcs.u64().serialize(params.nonce).toBytes(),
    new Uint8Array([params.curve]),
    bcs.u64().serialize(params.nonceChannel).toBytes(),
    params.metadataHash,
  ];

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const msg = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    msg.set(chunk, offset);
    offset += chunk.length;
  }
  return msg;
}

/**
 * Signs a SealedVault authorization with an Ed25519 keypair.
 * The resulting signature bytes are passed to unseal_and_mint on-chain.
 */
export async function signVaultEd25519(
  params: VaultParams,
  keypair: Ed25519Keypair
): Promise<Uint8Array> {
  const msg = buildVaultMessage(params);
  return await keypair.sign(msg);
}

/**
 * Signs a SealedVault authorization with a secp256k1 keypair (EVM-compatible).
 */
export async function signVaultSecp256k1(
  params: VaultParams,
  keypair: Secp256k1Keypair
): Promise<Uint8Array> {
  const msg = buildVaultMessage(params);
  return await keypair.sign(msg);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return new Uint8Array(clean.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
}
