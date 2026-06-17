import { Buffer } from "buffer";
import { webcrypto } from "crypto";
import { canonicalJsonBytes } from "./canonical.js";
import type { EncryptedOpenRailsLinkBlobV1, OpenRailsLink } from "./types.js";

const KEY_BYTES = 32;
const IV_BYTES = 12;

function getCrypto(): Crypto {
  return (globalThis.crypto ?? webcrypto) as Crypto;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url value.");
  }

  let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  return new Uint8Array(Buffer.from(normalized, "base64"));
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  getCrypto().getRandomValues(bytes);
  return bytes;
}

function assertLink(payload: unknown): OpenRailsLink {
  const parsed = payload as OpenRailsLink;
  if (!parsed || typeof parsed !== "object" || !parsed.envelope || !parsed.intent) {
    throw new Error("Decrypted payload is not a valid OpenRails link.");
  }
  return parsed;
}

function validateEncryptedBlob(blob: EncryptedOpenRailsLinkBlobV1): void {
  const keys = Object.keys(blob).sort();
  const expectedKeys = ["alg", "ciphertext", "iv", "keyMode", "kind", "plaintextType", "schemaVersion"];
  if (
    keys.length !== expectedKeys.length ||
    !keys.every((key, index) => key === expectedKeys[index]) ||
    blob.schemaVersion !== "1" ||
    blob.kind !== "openrails.encrypted-link" ||
    blob.plaintextType !== "openrails.link.v1" ||
    blob.alg !== "AES-256-GCM" ||
    blob.keyMode !== "fragment-key"
  ) {
    throw new Error("Unsupported encrypted OpenRails link blob.");
  }
  if (base64UrlDecode(blob.iv).length !== IV_BYTES) {
    throw new Error("Encrypted link IV must decode to 12 bytes.");
  }
  if (base64UrlDecode(blob.ciphertext).length === 0) {
    throw new Error("Encrypted link ciphertext cannot be empty.");
  }
}

function encryptionAad(blob: Omit<EncryptedOpenRailsLinkBlobV1, "ciphertext">): Uint8Array {
  return canonicalJsonBytes(blob);
}

function aadHeader(blob: EncryptedOpenRailsLinkBlobV1): Omit<EncryptedOpenRailsLinkBlobV1, "ciphertext"> {
  return {
    schemaVersion: blob.schemaVersion,
    kind: blob.kind,
    plaintextType: blob.plaintextType,
    alg: blob.alg,
    keyMode: blob.keyMode,
    iv: blob.iv,
  };
}

async function importAesKey(decryptionKey: string): Promise<CryptoKey> {
  const keyBytes = base64UrlDecode(decryptionKey);
  if (keyBytes.length !== KEY_BYTES) {
    throw new Error("Encrypted link key must decode to 32 bytes.");
  }
  return getCrypto().subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function generateEncryptedLinkKey(): string {
  return base64UrlEncode(randomBytes(KEY_BYTES));
}

export async function encryptOpenRailsLink(
  payload: OpenRailsLink,
  decryptionKey = generateEncryptedLinkKey()
): Promise<{ blob: EncryptedOpenRailsLinkBlobV1; decryptionKey: string }> {
  const iv = base64UrlEncode(randomBytes(IV_BYTES));
  const header = {
    schemaVersion: "1",
    kind: "openrails.encrypted-link",
    plaintextType: "openrails.link.v1",
    alg: "AES-256-GCM",
    keyMode: "fragment-key",
    iv,
  } as const;
  const key = await importAesKey(decryptionKey);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await getCrypto().subtle.encrypt(
    { name: "AES-GCM", iv: base64UrlDecode(iv), additionalData: encryptionAad(header) },
    key,
    plaintext
  );

  return {
    blob: {
      ...header,
      ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
    },
    decryptionKey,
  };
}

export async function decryptOpenRailsLink(
  blob: EncryptedOpenRailsLinkBlobV1,
  decryptionKey: string
): Promise<OpenRailsLink> {
  validateEncryptedBlob(blob);
  const key = await importAesKey(decryptionKey);
  const plaintext = await getCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlDecode(blob.iv),
      additionalData: encryptionAad(aadHeader(blob)),
    },
    key,
    base64UrlDecode(blob.ciphertext)
  );

  return assertLink(JSON.parse(new TextDecoder().decode(plaintext)));
}

export function buildEncryptedShortLink(
  blobId: string,
  decryptionKey: string,
  baseUrl?: string
): string {
  if (base64UrlDecode(decryptionKey).length !== KEY_BYTES) {
    throw new Error("Encrypted link key must decode to 32 bytes.");
  }
  return `${baseUrl ?? "https://rails.to/v1"}/${blobId}#k=${decryptionKey}`;
}

export function parseEncryptedShortLink(link: string): {
  blobId: string;
  decryptionKey: string;
  fetchUrl: string;
} {
  const parsed = new URL(link);
  const key = parsed.hash.startsWith("#k=") ? parsed.hash.slice(3) : "";
  if (base64UrlDecode(key).length !== KEY_BYTES) {
    throw new Error("Encrypted short link is missing a valid fragment key.");
  }

  parsed.hash = "";
  const parts = parsed.pathname.split("/").filter(Boolean);
  const blobId = parts[parts.length - 1];
  if (!blobId) {
    throw new Error("Encrypted short link is missing a blob ID.");
  }

  return {
    blobId,
    decryptionKey: key,
    fetchUrl: parsed.toString(),
  };
}
