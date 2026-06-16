import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import type { CryptographicEnvelopeV1, OpenRailsIntentV1 } from "./types.js";

function intentToBytes(intent: OpenRailsIntentV1, nonce: number): Uint8Array {
  const payload = JSON.stringify({ intent, nonce });
  return new TextEncoder().encode(payload);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Signs an OpenRails intent with an Ed25519 keypair (Sui native).
 * In @mysten/sui v1.x, keypair.sign() returns Promise<Uint8Array> (raw signature bytes).
 */
export async function signEnvelopeEd25519(
  intent: OpenRailsIntentV1,
  keypair: Ed25519Keypair,
  nonce?: number
): Promise<CryptographicEnvelopeV1> {
  const resolvedNonce = nonce ?? Date.now();
  const messageBytes = intentToBytes(intent, resolvedNonce);
  const signatureBytes = await keypair.sign(messageBytes);
  const publicKey = keypair.getPublicKey();

  return {
    payerPublicKey: toHex(publicKey.toRawBytes()),
    nonce: resolvedNonce,
    signature: toHex(signatureBytes),
    curve: "ed25519",
  };
}

/**
 * Signs an OpenRails intent with a secp256k1 keypair (EVM-compatible).
 * Allows Ethereum or Bitcoin key holders to authorize Sui-side Paycards.
 */
export async function signEnvelopeSecp256k1(
  intent: OpenRailsIntentV1,
  keypair: Secp256k1Keypair,
  nonce?: number
): Promise<CryptographicEnvelopeV1> {
  const resolvedNonce = nonce ?? Date.now();
  const messageBytes = intentToBytes(intent, resolvedNonce);
  const signatureBytes = await keypair.sign(messageBytes);
  const publicKey = keypair.getPublicKey();

  return {
    payerPublicKey: toHex(publicKey.toRawBytes()),
    nonce: resolvedNonce,
    signature: toHex(signatureBytes),
    curve: "secp256k1",
  };
}
