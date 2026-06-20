import { canonicalJsonBytes, domainSeparatedBytes } from "./canonical.js";
import type { IndexedSettlementReceiptV1 } from "./receipts.js";
import type { SettlementType } from "./types.js";

/**
 * Product receipt layer (V1.2). Business-readable receipts reconstructed from canonical
 * off-chain metadata + on-chain settlement evidence. The Move package never stores this
 * text — it only binds `metadata_hash` at mint, and these builders reproduce/verify it.
 */

export const PRODUCT_RECEIPT_SCHEMA_VERSION = "1.0" as const;
export const PRODUCT_METADATA_DOMAIN = "openrails.product-metadata" as const;

export type ProductReceiptType = "payment" | "settlement" | "residual_recovery";

/** Canonical off-chain terms. Hashed into the channel's on-chain `metadata_hash`. */
export interface ProductMetadataV1 {
  invoiceId: string;
  merchant: string; // merchant or service id/address
  productId?: string; // sku or service id
  payerRef?: string;
  description?: string;
  amount: string; // requested amount in base units (string to stay exact)
  token: string; // coin type / currency, e.g. "0x2::sui::SUI"
  terms?: string;
  expiresAt?: string; // ISO-8601
  usagePolicy?: string;
  orderRef?: string;
  walrusBlobId?: string;
}

export interface ProductSettlementBinding {
  transactionDigest: string;
  eventSeq: string;
  settlementType: SettlementType;
  totalPaidToRecipient: string;
  residualDeltaAmount: string;
}

export interface ProductReceiptV1 {
  schemaVersion: typeof PRODUCT_RECEIPT_SCHEMA_VERSION;
  receiptType: ProductReceiptType;
  receiptId: string;
  paycardId: string;
  payer: string;
  recipient: string;
  merchant: string;
  productId: string;
  metadataHash: string; // 0x-prefixed
  walrusBlobId?: string;
  issuedAt: string; // ISO-8601
  expiresAt?: string;
  settlementBinding?: ProductSettlementBinding;
  proofRef?: string;
  signature?: string;
}

// ─── hashing helpers ─────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function ensure0x(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return `0x${clean.toLowerCase()}`;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

/** Drop undefined-valued keys so canonical JSON never sees `undefined`. */
function pruneUndefined(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (val !== undefined) out[key] = val;
  }
  return out;
}

/**
 * Canonical, versioned metadata hash. The exact bytes a caller should pass to
 * `open` / `open-vault` (`--metadata-hash`) so the on-chain `metadata_hash` and the
 * product receipt agree. Any changed term changes the hash.
 */
export async function computeMetadataHash(metadata: ProductMetadataV1): Promise<Uint8Array> {
  return sha256(domainSeparatedBytes(PRODUCT_METADATA_DOMAIN, pruneUndefined(metadata)));
}

export async function metadataHashHex(metadata: ProductMetadataV1): Promise<string> {
  return ensure0x(toHex(await computeMetadataHash(metadata)));
}

export async function verifyMetadataHash(metadata: ProductMetadataV1, hashHex: string): Promise<boolean> {
  return (await metadataHashHex(metadata)) === ensure0x(hashHex);
}

// ─── receipt builders ────────────────────────────────────────────────────────

async function deriveReceiptId(receiptWithoutId: Omit<ProductReceiptV1, "receiptId">): Promise<string> {
  const { signature: _signature, ...forId } = receiptWithoutId;
  const digest = await sha256(canonicalJsonBytes(pruneUndefined(forId)));
  return `openrails_receipt_${toHex(digest)}`;
}

async function assemble(receiptWithoutId: Omit<ProductReceiptV1, "receiptId">): Promise<ProductReceiptV1> {
  return { receiptId: await deriveReceiptId(receiptWithoutId), ...receiptWithoutId };
}

function bindingFromReceipt(receipt: IndexedSettlementReceiptV1): ProductSettlementBinding {
  return {
    transactionDigest: receipt.transactionDigest ?? receipt.eventId.txDigest,
    eventSeq: receipt.eventSeq,
    settlementType: receipt.settlementType,
    totalPaidToRecipient: receipt.totalPaidToRecipient,
    residualDeltaAmount: receipt.residualDeltaAmount ?? receipt.residualReturnedToPayer,
  };
}

export interface CreatePaymentReceiptParams {
  metadata: ProductMetadataV1;
  metadataHash: string;
  paycardId: string;
  payer: string;
  recipient: string;
  issuedAt?: string;
  proofRef?: string;
}

/** Payment-intent receipt — issued at open, before settlement (no settlementBinding). */
export async function createPaymentReceipt(params: CreatePaymentReceiptParams): Promise<ProductReceiptV1> {
  const { metadata } = params;
  return assemble({
    schemaVersion: PRODUCT_RECEIPT_SCHEMA_VERSION,
    receiptType: "payment",
    paycardId: params.paycardId,
    payer: params.payer,
    recipient: params.recipient,
    merchant: metadata.merchant,
    productId: metadata.productId ?? metadata.invoiceId,
    metadataHash: ensure0x(params.metadataHash),
    walrusBlobId: metadata.walrusBlobId,
    issuedAt: params.issuedAt ?? new Date().toISOString(),
    expiresAt: metadata.expiresAt,
    proofRef: params.proofRef,
  });
}

export interface CreateSettlementReceiptParams {
  metadata: ProductMetadataV1;
  metadataHash: string;
  receipt: IndexedSettlementReceiptV1;
  issuedAt?: string;
  proofRef?: string;
}

/** Settlement receipt — binds the on-chain terminal SettlementReceipt evidence. */
export async function createSettlementReceipt(params: CreateSettlementReceiptParams): Promise<ProductReceiptV1> {
  const { metadata, receipt } = params;
  return assemble({
    schemaVersion: PRODUCT_RECEIPT_SCHEMA_VERSION,
    receiptType: "settlement",
    paycardId: receipt.paycardId,
    payer: receipt.payer,
    recipient: receipt.recipient,
    merchant: metadata.merchant,
    productId: metadata.productId ?? metadata.invoiceId,
    metadataHash: ensure0x(params.metadataHash),
    walrusBlobId: metadata.walrusBlobId,
    issuedAt: params.issuedAt ?? new Date().toISOString(),
    expiresAt: metadata.expiresAt,
    settlementBinding: bindingFromReceipt(receipt),
    proofRef: params.proofRef,
  });
}

/** Residual-recovery receipt — proof that unused capital returned to the payer. */
export async function createResidualRecoveryReceipt(params: CreateSettlementReceiptParams): Promise<ProductReceiptV1> {
  const { metadata, receipt } = params;
  return assemble({
    schemaVersion: PRODUCT_RECEIPT_SCHEMA_VERSION,
    receiptType: "residual_recovery",
    paycardId: receipt.paycardId,
    payer: receipt.payer,
    recipient: receipt.recipient,
    merchant: metadata.merchant,
    productId: metadata.productId ?? metadata.invoiceId,
    metadataHash: ensure0x(params.metadataHash),
    walrusBlobId: metadata.walrusBlobId,
    issuedAt: params.issuedAt ?? new Date().toISOString(),
    expiresAt: metadata.expiresAt,
    settlementBinding: bindingFromReceipt(receipt),
    proofRef: params.proofRef,
  });
}
