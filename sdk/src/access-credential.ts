import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1PublicKey } from "@mysten/sui/keypairs/secp256k1";
import { domainSeparatedBytes } from "./canonical.js";
import { bytesToHex, hexToBytes, type EnvelopeSigner } from "./signer.js";
import { base64UrlEncode, base64UrlDecode } from "./link-encryption.js";
import { getChannelState } from "./channel-state.js";
import type { OpenRailsApiClient } from "./api.js";
import type { SuiClient } from "@mysten/sui/client";

/**
 * Access credentials (V1.2). A payer-signed bearer token a service verifies to grant
 * access against a live channel: `Authorization: OpenRails <credential>`. The credential
 * is self-authenticating — the payer signs the claims, and a verifier checks the signature
 * plus the channel's on-chain state. Merchant co-signing is optional.
 */

export const ACCESS_CREDENTIAL_SCHEMA_VERSION = "1.0" as const;
export const ACCESS_CREDENTIAL_DOMAIN = "openrails.access-credential" as const;
export const ACCESS_AUTH_SCHEME = "OpenRails" as const;
export const HEADER_PAYCARD_ID = "X-OpenRails-Paycard-Id" as const;
export const HEADER_METADATA_HASH = "X-OpenRails-Metadata-Hash" as const;

export type CredentialCurve = "ed25519" | "secp256k1";

export interface AccessCredentialClaimsV1 {
  schemaVersion: typeof ACCESS_CREDENTIAL_SCHEMA_VERSION;
  paycardId: string;
  /** Sui address that controls the channel — must equal the signer's address. */
  payer: string;
  recipient?: string;
  /** Merchant / service identifier the credential grants access to. */
  service: string;
  productReceiptId?: string;
  metadataHash: string; // 0x...
  issuedAt: string; // ISO-8601
  expiresAt: string; // ISO-8601
  nonce: number;
}

export interface CredentialSignature {
  publicKey: string; // hex
  signature: string; // hex
  curve: CredentialCurve;
}

export interface AccessCredentialV1 {
  claims: AccessCredentialClaimsV1;
  signerPublicKey: string; // hex (payer)
  signature: string; // hex
  curve: CredentialCurve;
  merchant?: CredentialSignature; // optional co-sign over the same claims
}

function claimsBytes(claims: AccessCredentialClaimsV1): Uint8Array {
  return domainSeparatedBytes(ACCESS_CREDENTIAL_DOMAIN, claims);
}

function publicKeyFor(curve: CredentialCurve, hex: string) {
  const bytes = hexToBytes(hex);
  return curve === "ed25519" ? new Ed25519PublicKey(bytes) : new Secp256k1PublicKey(bytes);
}

export function pubkeyToSuiAddress(curve: CredentialCurve, hex: string): string {
  return publicKeyFor(curve, hex).toSuiAddress();
}

export async function issueAccessCredential(
  claims: AccessCredentialClaimsV1,
  signer: EnvelopeSigner,
  curve: CredentialCurve = "ed25519",
  merchant?: { signer: EnvelopeSigner; curve?: CredentialCurve },
): Promise<AccessCredentialV1> {
  const bytes = claimsBytes(claims);
  const credential: AccessCredentialV1 = {
    claims,
    signerPublicKey: bytesToHex(signer.getPublicKey().toRawBytes()),
    signature: bytesToHex(await signer.sign(bytes)),
    curve,
  };
  if (merchant) {
    const mCurve = merchant.curve ?? "ed25519";
    credential.merchant = {
      publicKey: bytesToHex(merchant.signer.getPublicKey().toRawBytes()),
      signature: bytesToHex(await merchant.signer.sign(bytes)),
      curve: mCurve,
    };
  }
  return credential;
}

export async function verifyAccessCredentialSignature(credential: AccessCredentialV1): Promise<boolean> {
  try {
    const bytes = claimsBytes(credential.claims);
    const payerOk = await publicKeyFor(credential.curve, credential.signerPublicKey).verify(
      bytes,
      hexToBytes(credential.signature),
    );
    if (!payerOk) return false;
    if (credential.merchant) {
      const merchantOk = await publicKeyFor(credential.merchant.curve, credential.merchant.publicKey).verify(
        bytes,
        hexToBytes(credential.merchant.signature),
      );
      if (!merchantOk) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── encoding + headers ───────────────────────────────────────────────────────
export function encodeAccessCredential(credential: AccessCredentialV1): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(credential)));
}

export function parseAccessCredential(token: string): AccessCredentialV1 {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(token))) as AccessCredentialV1;
}

export function buildAuthorizationHeader(credential: AccessCredentialV1): string {
  return `${ACCESS_AUTH_SCHEME} ${encodeAccessCredential(credential)}`;
}

export function parseAuthorizationHeader(value: string | null | undefined): AccessCredentialV1 | null {
  if (!value) return null;
  const trimmed = value.trim();
  const space = trimmed.indexOf(" ");
  if (space < 0) return null;
  const scheme = trimmed.slice(0, space);
  const token = trimmed.slice(space + 1).trim();
  if (scheme !== ACCESS_AUTH_SCHEME || !token) return null;
  try {
    return parseAccessCredential(token);
  } catch {
    return null;
  }
}

// ── full verification ────────────────────────────────────────────────────────
export type AccessDecisionReason =
  | "ok"
  | "bad_signature"
  | "payer_mismatch"
  | "expired"
  | "channel_settled"
  | "channel_inactive";

export interface AccessDecision {
  granted: boolean;
  reason: AccessDecisionReason;
  paycardId: string;
}

export interface ChannelStatusResolution {
  active: boolean;
  settled?: boolean;
  status?: string;
}

export type ChannelResolver = (paycardId: string) => Promise<ChannelStatusResolution>;

/**
 * Full grant/deny: signature ✓ → payer matches signer address ✓ → not expired ✓ →
 * channel active (not settled) ✓. `metadataHash` is signature-covered (the payer attests
 * the terms) but is not yet cross-checked against the on-chain value — that needs
 * ChannelMetadataAnchored indexing (deferred).
 */
export async function verifyAccessCredential(params: {
  credential: AccessCredentialV1;
  resolveChannel: ChannelResolver;
  nowMs?: number;
}): Promise<AccessDecision> {
  const { credential } = params;
  const now = params.nowMs ?? Date.now();
  const paycardId = credential.claims.paycardId;

  if (!(await verifyAccessCredentialSignature(credential))) {
    return { granted: false, reason: "bad_signature", paycardId };
  }
  if (pubkeyToSuiAddress(credential.curve, credential.signerPublicKey) !== credential.claims.payer) {
    return { granted: false, reason: "payer_mismatch", paycardId };
  }
  if (Date.parse(credential.claims.expiresAt) <= now) {
    return { granted: false, reason: "expired", paycardId };
  }

  const channel = await params.resolveChannel(paycardId);
  if (channel.settled) return { granted: false, reason: "channel_settled", paycardId };
  if (!channel.active) return { granted: false, reason: "channel_inactive", paycardId };
  return { granted: true, reason: "ok", paycardId };
}

/** Resolver that reads the Paycard object directly (merchant backend / Worker). */
export function channelResolverFromClient(client: Pick<SuiClient, "getObject">): ChannelResolver {
  return async (paycardId) => {
    const state = await getChannelState({ client, paycardId });
    return {
      active: state.active,
      settled: state.status === "depleted" || state.status === "cancelled",
      status: state.status,
    };
  };
}

/** Resolver that uses the public proof API's active|settled status. */
export function channelResolverFromApi(apiClient: Pick<OpenRailsApiClient, "getProof">): ChannelResolver {
  return async (paycardId) => {
    const proof = await apiClient.getProof(paycardId);
    if (!proof) return { active: false, status: "missing" };
    return { active: proof.status === "active", settled: proof.status === "settled", status: proof.status };
  };
}
