import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import type { StreamState } from "./accrual.js";
import { projectStreamAt } from "./accrual.js";
import { CANONICAL_SCHEMA_VERSION, canonicalGatewayEventBytes } from "./canonical.js";

export interface GatewayEventSigner {
  sign(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface GatewayEventBase {
  schemaVersion: "1";
  eventId: string;
  eventType: string;
  paycardId: string;
  timestamp: number;
  sequence: number;
}

export interface StreamHeartbeat extends GatewayEventBase {
  eventType: "stream.accrual_heartbeat";
  accruedSinceCheckpoint: string;   // bigint serialised as decimal string
  projectedBalance: string;         // bigint serialised as decimal string
  isExhausted: boolean;
  signature: string;
}

export interface BufferLowEvent extends GatewayEventBase {
  eventType: "channel.buffer_low";
  projectedBalance: string;
  threshold: string;
  signature: string;
}

export interface GatewayTerminalEvent extends GatewayEventBase {
  eventType: "channel.terminated";
  initialAllocation?: string;
  maxFlowRatePerSecond?: string;
  startTimestamp?: number;
  durationSeconds?: number;
  residualDeltaRecipient?: string;
  residualDeltaAmount?: string;
  settlementType: number;
  totalPaidToRecipient: string;
  residualReturnedToPayer: string;
  closedAtSeconds: number;
  transactionDigest?: string;
  signature: string;
}

export type SignedGatewayEvent = StreamHeartbeat | BufferLowEvent | GatewayTerminalEvent;

export type GatewayTerminalEventInput =
  Omit<GatewayTerminalEvent, "schemaVersion" | "eventId" | "eventType" | "timestamp" | "sequence" | "signature"> & {
    eventId?: string;
  };

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("Invalid hex string.");
  }
  return new Uint8Array(clean.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? []);
}

function defaultEventId(eventType: string, paycardId: string, sequence: number, timestamp: number): string {
  return `${eventType}:${paycardId}:${sequence}:${timestamp}`;
}

function signedEventMessage(event: Omit<SignedGatewayEvent, "signature">): Uint8Array {
  return canonicalGatewayEventBytes(event);
}

/**
 * Projects stream accrual at currentTimeSec and signs a heartbeat payload
 * with the gateway's Ed25519 keypair. The signature covers a deterministic
 * JSON encoding of all payload fields (excluding the signature itself).
 */
export async function buildHeartbeat(
  state: StreamState,
  currentTimeSec: number,
  signerKeypair: GatewayEventSigner,
  sequence = 0,
  eventId?: string
): Promise<StreamHeartbeat> {
  const { accrued, remaining, isExhausted } = projectStreamAt(state, currentTimeSec);

  const unsigned: Omit<StreamHeartbeat, "signature"> = {
    schemaVersion:          CANONICAL_SCHEMA_VERSION,
    eventId:                eventId ?? defaultEventId("stream.accrual_heartbeat", state.paycardId, sequence, currentTimeSec),
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
  signerKeypair: GatewayEventSigner,
  eventId?: string
): Promise<BufferLowEvent> {
  const unsigned: Omit<BufferLowEvent, "signature"> = {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: eventId ?? defaultEventId("channel.buffer_low", paycardId, sequence, currentTimeSec),
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
  event: GatewayTerminalEventInput,
  currentTimeSec: number,
  sequence: number,
  signerKeypair: GatewayEventSigner
): Promise<GatewayTerminalEvent> {
  const unsigned: Omit<GatewayTerminalEvent, "signature"> = {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    eventId: event.eventId ?? defaultEventId("channel.terminated", event.paycardId, sequence, currentTimeSec),
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
  try {
    const { signature, ...unsigned } = event;
    const msgBytes = signedEventMessage(unsigned);
    const sigBytes = hexToBytes(signature);
    const pubkeyBytes = hexToBytes(gatewayPublicKeyHex);
    const pubkey = new Ed25519PublicKey(pubkeyBytes);
    return pubkey.verify(msgBytes, sigBytes);
  } catch {
    return false;
  }
}
