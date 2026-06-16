import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import type { StreamState } from "./accrual.js";
import { projectStreamAt } from "./accrual.js";

export interface StreamHeartbeat {
  eventType: "stream.accrual_heartbeat";
  paycardId: string;
  timestamp: number;
  sequence: number;
  accruedSinceCheckpoint: string;   // bigint serialised as decimal string
  projectedBalance: string;         // bigint serialised as decimal string
  isExhausted: boolean;
  signature: string;
}

export interface BufferLowEvent {
  eventType: "channel.buffer_low";
  paycardId: string;
  timestamp: number;
  sequence: number;
  projectedBalance: string;
  threshold: string;
  signature: string;
}

export interface GatewayTerminalEvent {
  eventType: "channel.terminated";
  paycardId: string;
  timestamp: number;
  sequence: number;
  settlementType: number;
  totalPaidToRecipient: string;
  residualReturnedToPayer: string;
  closedAtSeconds: number;
  signature: string;
}

export type SignedGatewayEvent = StreamHeartbeat | BufferLowEvent | GatewayTerminalEvent;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function signedEventMessage(event: Omit<SignedGatewayEvent, "signature">): Uint8Array {
  const sorted = Object.fromEntries(
    Object.entries(event).sort(([a], [b]) => a.localeCompare(b))
  );
  const json = JSON.stringify(sorted);
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
  signerKeypair: Ed25519Keypair,
  sequence = 0
): Promise<StreamHeartbeat> {
  const { accrued, remaining, isExhausted } = projectStreamAt(state, currentTimeSec);

  const unsigned: Omit<StreamHeartbeat, "signature"> = {
    eventType:              "stream.accrual_heartbeat",
    paycardId:              state.paycardId,
    timestamp:              currentTimeSec,
    sequence,
    accruedSinceCheckpoint: accrued.toString(),
    projectedBalance:       remaining.toString(),
    isExhausted,
  };

  const msgBytes = signedEventMessage(unsigned);
  const sigBytes = await signerKeypair.sign(msgBytes);

  return { ...unsigned, signature: toHex(sigBytes) };
}

export async function buildBufferLowEvent(
  paycardId: string,
  projectedBalance: bigint,
  threshold: bigint,
  currentTimeSec: number,
  sequence: number,
  signerKeypair: { sign(bytes: Uint8Array): Promise<Uint8Array> }
): Promise<BufferLowEvent> {
  const unsigned: Omit<BufferLowEvent, "signature"> = {
    eventType: "channel.buffer_low",
    paycardId,
    timestamp: currentTimeSec,
    sequence,
    projectedBalance: projectedBalance.toString(),
    threshold: threshold.toString(),
  };
  const sigBytes = await signerKeypair.sign(signedEventMessage(unsigned));
  return { ...unsigned, signature: toHex(sigBytes) };
}

export async function buildTerminalEvent(
  event: Omit<GatewayTerminalEvent, "eventType" | "timestamp" | "sequence" | "signature">,
  currentTimeSec: number,
  sequence: number,
  signerKeypair: { sign(bytes: Uint8Array): Promise<Uint8Array> }
): Promise<GatewayTerminalEvent> {
  const unsigned: Omit<GatewayTerminalEvent, "signature"> = {
    eventType: "channel.terminated",
    timestamp: currentTimeSec,
    sequence,
    ...event,
  };
  const sigBytes = await signerKeypair.sign(signedEventMessage(unsigned));
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
  return verifyGatewayEvent(heartbeat, gatewayPublicKeyHex);
}

export async function verifyGatewayEvent(
  event: SignedGatewayEvent,
  gatewayPublicKeyHex: string
): Promise<boolean> {
  const { signature, ...unsigned } = event;
  const msgBytes = signedEventMessage(unsigned);
  const sigBytes = new Uint8Array(
    signature.match(/.{2}/g)!.map((b) => parseInt(b, 16))
  );
  const pubkeyBytes = new Uint8Array(
    gatewayPublicKeyHex.replace(/^0x/, "").match(/.{2}/g)!.map((b) => parseInt(b, 16))
  );

  const pubkey = new Ed25519PublicKey(pubkeyBytes);
  return pubkey.verify(msgBytes, sigBytes);
}
