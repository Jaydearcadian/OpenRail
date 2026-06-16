import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256k1PublicKey } from "@mysten/sui/keypairs/secp256k1";
import type { CryptographicEnvelopeV1, OpenRailsIntentV1, RailsFlowPayload } from "./types.js";

export type SignableIntentV1 = OpenRailsIntentV1 & { merchantAddress?: string };

function intentToBytes(intent: SignableIntentV1, nonce: number): Uint8Array {
  const payload = JSON.stringify({ intent, nonce });
  return new TextEncoder().encode(payload);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("Invalid hex string.");
  }
  return new Uint8Array(clean.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? []);
}

export function bindRailsFlowMerchant(
  intent: OpenRailsIntentV1,
  merchantAddress: string
): SignableIntentV1 {
  return { ...intent, merchantAddress };
}

/**
 * Signs an OpenRails intent with an Ed25519 keypair (Sui native).
 * In @mysten/sui v1.x, keypair.sign() returns Promise<Uint8Array> (raw signature bytes).
 */
export async function signEnvelopeEd25519(
  intent: SignableIntentV1,
  keypair: Ed25519Keypair,
  nonce?: number
): Promise<CryptographicEnvelopeV1> {
  const resolvedNonce = nonce ?? Date.now();
  const messageBytes = intentToBytes(intent, resolvedNonce);
  const signatureBytes = await keypair.sign(messageBytes);
  const publicKey = keypair.getPublicKey();

  return {
    payerPublicKey: bytesToHex(publicKey.toRawBytes()),
    nonce: resolvedNonce,
    signature: bytesToHex(signatureBytes),
    curve: "ed25519",
  };
}

/**
 * Signs an OpenRails intent with a secp256k1 keypair (EVM-compatible).
 * Allows Ethereum or Bitcoin key holders to authorize Sui-side Paycards.
 */
export async function signEnvelopeSecp256k1(
  intent: SignableIntentV1,
  keypair: Secp256k1Keypair,
  nonce?: number
): Promise<CryptographicEnvelopeV1> {
  const resolvedNonce = nonce ?? Date.now();
  const messageBytes = intentToBytes(intent, resolvedNonce);
  const signatureBytes = await keypair.sign(messageBytes);
  const publicKey = keypair.getPublicKey();

  return {
    payerPublicKey: bytesToHex(publicKey.toRawBytes()),
    nonce: resolvedNonce,
    signature: bytesToHex(signatureBytes),
    curve: "secp256k1",
  };
}

export async function verifyEnvelope(
  intent: SignableIntentV1,
  envelope: CryptographicEnvelopeV1
): Promise<boolean> {
  const messageBytes = intentToBytes(intent, envelope.nonce);
  const signatureBytes = hexToBytes(envelope.signature);
  const publicKeyBytes = hexToBytes(envelope.payerPublicKey);

  if (envelope.curve === "ed25519") {
    return new Ed25519PublicKey(publicKeyBytes).verify(messageBytes, signatureBytes);
  }
  if (envelope.curve === "secp256k1") {
    return new Secp256k1PublicKey(publicKeyBytes).verify(messageBytes, signatureBytes);
  }
  return false;
}

export async function verifyRailsFlowMerchantEnvelope(
  payload: RailsFlowPayload
): Promise<boolean> {
  return verifyEnvelope(
    bindRailsFlowMerchant(payload.intent, payload.merchantAddress),
    payload.envelope
  );
}
