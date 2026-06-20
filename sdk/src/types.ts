// --- On-Chain Config ---

export interface SuiAssetConfig {
  packageId: string;
  moduleName: string;
  typeArgument: string; // e.g. "0x2::sui::SUI" or "0xabc::usdc::USDC"
}

// --- Intent & Envelope ---

export interface OpenRailsIntentV1 {
  schemaVersion?: "1";
  paycardId: string;              // 32-byte unique hex identifier (client-generated before mint)
  asset: SuiAssetConfig;
  allocationPoolSize: string;     // Absolute token units including safety buffer
  maxFlowRatePerSecond: string;   // Token units per second
  startTimestamp: number;         // Unix seconds
  durationSeconds: number;
  residualDeltaRecipient: string; // STN-Delta recovery address
  walrusBlobId?: string;          // Optional: 32-byte hex BlobID anchored at mint
}

export interface CryptographicEnvelopeV1 {
  schemaVersion?: "1";
  payerPublicKey: string;         // Hex-encoded public key
  nonce: number;
  signature: string;              // Hex-encoded signature over canonical intent + nonce
  curve: "ed25519" | "secp256k1";
}

export interface OpenRailsPayloadV1 {
  schemaVersion?: "1";
  envelope: CryptographicEnvelopeV1;
  intent: OpenRailsIntentV1;
}

// --- Link Types ---

/** Outbound grant — payer creates, recipient field may be blank or wildcarded */
export interface RailsCardPayload extends OpenRailsPayloadV1 {
  linkType: "railscard";
  vaultObjectId: string;           // SealedVault object to unseal before Paycard mint
  vaultSignature: string;          // Hex signature over sealed_vault::build_vault_message()
  recipientAddress?: string;      // Optional wildcard; filled by claimant at broadcast
}

/** Inbound billing memo — merchant creates with hardcoded payout address */
export interface RailsFlowPayload extends OpenRailsPayloadV1 {
  linkType: "railsflow";
  merchantAddress: string;        // Hardcoded; cannot be altered by payer
  invoiceDescription?: string;    // Signed invoice metadata when present
}

export type OpenRailsLink = RailsCardPayload | RailsFlowPayload;

// --- Encrypted Links ---

export interface EncryptedOpenRailsLinkBlobV1 {
  schemaVersion: "1";
  kind: "openrails.encrypted-link";
  plaintextType: "openrails.link.v1";
  alg: "AES-256-GCM";
  keyMode: "fragment-key";
  iv: string;          // base64url 12-byte AES-GCM nonce
  ciphertext: string;  // base64url encrypted OpenRailsLink JSON plus GCM tag
}

// --- Walrus Storage Options ---

export interface WalrusStorageOptions {
  epochs?: number;     // Storage duration in epochs (default: 1 — auto-purged after one epoch)
  deletable?: boolean; // Store as deletable blob (default: true)
}

// --- Walrus Metadata ---

export interface WalrusMetadataV1 {
  version: "1.0";
  paycardId: string;
  allowedCallers?: string[];      // IP whitelist or wallet address whitelist
  splitConfigs?: SplitConfig[];
  vendorPublicKeys?: string[];
  complianceRules?: Record<string, unknown>;
  createdAt: number;
}

export interface SplitConfig {
  address: string;
  basisPoints: number;            // Out of 10000
}

// --- PTB Builder Params ---

export interface MintParams {
  packageId: string;
  coinObjectId: string;           // Payer's Coin<T> object (Move splits from this directly)
  totalProvisionAmount: bigint;
  maxFlowRatePerSecond: bigint;
  recipient: string;
  startTimestamp: number;         // Unix seconds
  durationSeconds: number;
  recoveryTarget: string;
  typeArgument: string;           // Full coin type: "0x2::sui::SUI"
  blobId?: Uint8Array;            // Optional 32-byte Walrus BlobID to anchor at mint
}

export interface ClaimParams {
  packageId: string;
  paycardObjectId: string;
  clockObjectId?: string;         // Defaults to SUI_CLOCK_OBJECT_ID = "0x6"
  typeArgument: string;
}

export interface ClaimAndSwapParams {
  packageId: string;              // OpenRails package
  paycardObjectId: string;
  clockObjectId?: string;
  baseTypeArgument: string;       // Stream token (e.g. USDC)
  quoteTypeArgument: string;      // Merchant's preferred token (e.g. SUI)
  minQuoteOut: bigint;
  recipient: string;
  senderAddress: string;          // Receives base + DEEP remainders
  // DeepBook V3 routing
  deepbookPackageId: string;      // Published DeepBook V3 package ID
  poolObjectId: string;           // Pool<Base, Quote> shared object
  deepTypeArgument: string;       // DEEP coin type: "<DEEP_PKG>::deep::DEEP"
  deepCoinObjectId?: string;      // DEEP fee coin; omit for whitelisted pools (zero fee)
}

// --- Sealed Vault (RailsCard) PTB Params ---

export interface CreateVaultParams {
  packageId: string;
  coinObjectId: string;             // Funding Coin<T> for the allocation pool
  allocationAmount: bigint;
  gasCoinObjectId: string;          // Coin<SUI> to fund the recipient's gas reserve
  gasAmount: bigint;                // Tier-2 gas reserve (SUI base units); 0 disables
  payerPubkeyHex: string;           // hex-encoded Ed25519 (32 bytes) or secp256k1 compressed (33 bytes)
  maxFlowRatePerSecond: bigint;
  durationSeconds: number;
  /** 0 = dynamic (stream starts when recipient unseals); non-zero = Unix seconds */
  startTimestamp: number;
  recoveryTarget: string;
  nonce: bigint;
  /** CURVE_ED25519 = 0, CURVE_SECP256K1 = 1 */
  curve: number;
  typeArgument: string;
}

export interface UnsealVaultParams {
  packageId: string;
  vaultObjectId: string;
  signature: Uint8Array;            // Ed25519 or secp256k1 signature from signVault*()
  recipient: string;
  blobId?: Uint8Array;              // Optional 32-byte Walrus BlobID anchored into Paycard at mint
  clockObjectId?: string;
  typeArgument: string;
}

export interface ResolveParams {
  packageId: string;
  paycardObjectId: string;
  clockObjectId?: string;
  typeArgument: string;
}

export interface CancelParams {
  packageId: string;
  paycardObjectId: string;
  clockObjectId?: string;  // Defaults to SUI_CLOCK_OBJECT_ID = "0x6"
  typeArgument: string;
}

// --- Settlement Receipt ---

export const SETTLEMENT_TYPE_DEPLETED  = 0 as const;
export const SETTLEMENT_TYPE_EXPIRED   = 1 as const;
export const SETTLEMENT_TYPE_CANCELLED = 2 as const;

export type SettlementType =
  | typeof SETTLEMENT_TYPE_DEPLETED
  | typeof SETTLEMENT_TYPE_EXPIRED
  | typeof SETTLEMENT_TYPE_CANCELLED;

/**
 * Parsed representation of the on-chain OpenRails_V1.SettlementReceipt event.
 * Emitted at every terminal Paycard state — the canonical Web2 audit-log entry.
 *
 *   depleted  (0): recipient claimed the full allocation
 *   expired   (1): stream elapsed; residual swept back to payer via STN-Delta
 *   cancelled (2): payer cancelled; remaining balance refunded
 *
 * total_paid_to_recipient + residual_returned_to_payer == initial_allocation (value-conserving)
 * Amounts are strings to avoid JS number precision issues on large u64 values.
 */
export interface SettlementReceiptV1 {
  paycardId: string;                // Sui object ID, hex with 0x prefix
  payer: string;                    // original payer address
  recipient: string;                // stream recipient address
  initialAllocation?: string;       // V1.1 channel allocation, raw token base units
  maxFlowRatePerSecond?: string;    // V1.1 channel velocity, raw token base units per second
  startTimestamp?: number;          // V1.1 channel start, Unix seconds
  durationSeconds?: number;         // V1.1 channel duration
  residualDeltaRecipient?: string;  // V1.1 STN-Delta recovery address
  residualDeltaAmount?: string;     // V1.1 amount routed by STN-Delta
  totalPaidToRecipient: string;     // raw token base units
  residualReturnedToPayer: string;  // legacy-compatible alias for residualDeltaAmount
  settlementType: SettlementType;
  closedAtSeconds: number;          // Unix timestamp of closure
  transactionDigest?: string;       // filled in by off-chain indexer
}
