import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import type { StreamState } from "./accrual.js";
import { projectStreamAt } from "./accrual.js";

export interface StreamHeartbeat {
  paycardId: string;
  timestamp: number;                // Unix seconds — when snapshot was taken
  accruedSinceCheckpoint: string;   // bigint serialised as decimal string
  projectedBalance: string;         // bigint serialised as decimal string
  isExhausted: boolean;
  signature: string;                // hex Ed25519 sig over deterministic JSON of fields above
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function heartbeatMessage(hb: Omit<StreamHeartbeat, "signature">): Uint8Array {
  // Deterministic: sorted keys, no trailing whitespace.
  const json = JSON.stringify({
    paycardId:               hb.paycardId,
    timestamp:               hb.timestamp,
    accruedSinceCheckpoint:  hb.accruedSinceCheckpoint,
    projectedBalance:        hb.projectedBalance,
    isExhausted:             hb.isExhausted,
  });
  return new TextEncoder().encode(json);
}

/**
 * Projects stream accrual at currentTimeSec and signs a heartbeat payload
 * with the gateway's Ed25519 keypair. The signature covers a deterministic
 * JSON encoding of all payload fields (excluding the signature itself).
 */
export async function buildHeartbeat(
  state: StreamState,
  currentTimeSec: number,
  signerKeypair: Ed25519Keypair
): Promise<StreamHeartbeat> {
  const { accrued, remaining, isExhausted } = projectStreamAt(state, currentTimeSec);

  const unsigned: Omit<StreamHeartbeat, "signature"> = {
    paycardId:              state.paycardId,
    timestamp:              currentTimeSec,
    accruedSinceCheckpoint: accrued.toString(),
    projectedBalance:       remaining.toString(),
    isExhausted,
  };

  const msgBytes = heartbeatMessage(unsigned);
  const sigBytes = await signerKeypair.sign(msgBytes);

  return { ...unsigned, signature: toHex(sigBytes) };
}

/**
 * Verifies a StreamHeartbeat against the gateway's known public key.
 * Returns true if the signature is valid and covers the payload fields.
 */
export async function verifyHeartbeat(
  heartbeat: StreamHeartbeat,
  gatewayPublicKeyHex: string
): Promise<boolean> {
  const { signature, ...unsigned } = heartbeat;
  const msgBytes = heartbeatMessage(unsigned);
  const sigBytes = new Uint8Array(
    signature.match(/.{2}/g)!.map((b) => parseInt(b, 16))
  );
  const pubkeyBytes = new Uint8Array(
    gatewayPublicKeyHex.replace(/^0x/, "").match(/.{2}/g)!.map((b) => parseInt(b, 16))
  );

  const pubkey = new Ed25519PublicKey(pubkeyBytes);
  return pubkey.verify(msgBytes, sigBytes);
}
