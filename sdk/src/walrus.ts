import { Buffer } from "buffer";
import type { WalrusMetadataV1, WalrusStorageOptions, OpenRailsLink } from "./types.js";

export interface WalrusUploadResult {
  blobId: string;       // 32-byte hex string
  blobObjectId: string; // On-chain Blob object ID on Sui
}

/** Known Walrus endpoint URLs */
export const WALRUS_ENDPOINTS = {
  testnet: {
    publisher: "https://publisher.walrus-testnet.walrus.space",
    aggregator: "https://aggregator.walrus-testnet.walrus.space",
  },
  mainnet: {
    publisher: "https://publisher.walrus.space",
    aggregator: "https://aggregator.walrus.space",
  },
} as const;

// --- Internal helpers ---

function buildUploadUrl(publisherUrl: string, opts?: WalrusStorageOptions): string {
  const epochs = opts?.epochs ?? 1;
  const deletable = opts?.deletable ?? true;
  return `${publisherUrl}/v1/blobs?epochs=${epochs}&deletable=${deletable}`;
}

export function walrusBlobIdToBytes(blobId: string): Uint8Array {
  const clean = blobId.startsWith("0x") ? blobId.slice(2) : blobId;
  let bytes: Uint8Array;

  if (/^[0-9a-fA-F]{64}$/.test(clean)) {
    bytes = new Uint8Array(clean.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  } else {
    let normalized = clean.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) normalized += "=";
    bytes = new Uint8Array(Buffer.from(normalized, "base64"));
  }

  if (bytes.length !== 32) {
    throw new Error("Walrus BlobID must decode to exactly 32 bytes.");
  }

  return bytes;
}

async function putBlob(url: string, bytes: Uint8Array): Promise<WalrusUploadResult> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Walrus upload failed (${response.status}): ${body}`);
  }

  const result = await response.json() as {
    newlyCreated?: { blobObject: { blobId: string; id: string } };
    alreadyCertified?: { blobId: string };
  };

  if (result.newlyCreated) {
    return {
      blobId: result.newlyCreated.blobObject.blobId,
      blobObjectId: result.newlyCreated.blobObject.id,
    };
  }
  if (result.alreadyCertified) {
    return { blobId: result.alreadyCertified.blobId, blobObjectId: "" };
  }

  throw new Error("Walrus response missing both newlyCreated and alreadyCertified fields.");
}

// --- Public API ---

/**
 * Uploads compliance/metadata JSON to Walrus.
 * opts.epochs controls storage duration (default 1); opts.deletable defaults to true.
 */
export async function uploadMetadata(
  metadata: WalrusMetadataV1,
  publisherUrl: string,
  opts?: WalrusStorageOptions
): Promise<WalrusUploadResult> {
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  return putBlob(buildUploadUrl(publisherUrl, opts), bytes);
}

/**
 * Fetches and parses a WalrusMetadataV1 blob via aggregator REST API (zero gas).
 */
export async function fetchMetadata(
  blobId: string,
  aggregatorUrl: string
): Promise<WalrusMetadataV1> {
  const response = await fetch(`${aggregatorUrl}/v1/blobs/${blobId}`);
  if (!response.ok) {
    throw new Error(`Walrus fetch failed (${response.status}) for blob ${blobId}`);
  }
  return JSON.parse(await response.text()) as WalrusMetadataV1;
}

/**
 * Uploads a Permission Envelope (OpenRailsLink) to Walrus as a short-lived blob.
 * Returns the BlobID, on-chain object ID, and a ready-to-share short link.
 * Default: epochs=1 (auto-purged after one epoch), deletable=true.
 */
export async function uploadEnvelope(
  payload: OpenRailsLink,
  publisherUrl: string,
  opts?: WalrusStorageOptions
): Promise<WalrusUploadResult & { shortLink: string }> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const result = await putBlob(buildUploadUrl(publisherUrl, opts), bytes);
  return { ...result, shortLink: buildShortLink(result.blobId) };
}

/**
 * Fetches a Permission Envelope by BlobID from a Walrus aggregator (zero gas).
 * Validates the returned JSON has the required envelope and intent fields.
 */
export async function fetchEnvelope(
  blobId: string,
  aggregatorUrl: string
): Promise<OpenRailsLink> {
  const response = await fetch(`${aggregatorUrl}/v1/blobs/${blobId}`);
  if (!response.ok) {
    throw new Error(`Walrus fetch failed (${response.status}) for blob ${blobId}`);
  }
  const parsed = JSON.parse(await response.text()) as OpenRailsLink;
  if (!parsed.envelope || !parsed.intent) {
    throw new Error("Walrus blob is not a valid OpenRails Permission Envelope.");
  }
  return parsed;
}

/**
 * Formats a Walrus BlobID into an OpenRails short link.
 * baseUrl defaults to "https://rails.to/v1"; override for self-hosted resolvers.
 */
export function buildShortLink(blobId: string, baseUrl?: string): string {
  return `${baseUrl ?? "https://rails.to/v1"}/${blobId}`;
}
