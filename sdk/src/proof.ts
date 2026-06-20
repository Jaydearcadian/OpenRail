import type { SignedGatewayEvent } from "./heartbeat.js";
import type { IndexedSettlementReceiptV1 } from "./receipts.js";

export const OPENRAILS_PROTOCOL_VERSION_V1_1 = "1.1" as const;
export const OPENRAILS_PROOF_SCHEMA_VERSION_V1_1 = "1.1" as const;

export type OpenRailsProtocolVersion = typeof OPENRAILS_PROTOCOL_VERSION_V1_1;
export type OpenRailsProofSchemaVersion = typeof OPENRAILS_PROOF_SCHEMA_VERSION_V1_1;
export type OpenRailsProofStatus = "active" | "settled";
export type OpenRailsProofBoundary =
  | "sui_package"
  | "sui_paycard"
  | "gateway_projection"
  | "settlement_receipt";

export interface OpenRailsProofStreamState {
  paycardId: string;
  latestEventId: string;
  latestEventType: SignedGatewayEvent["eventType"];
  latestSequence: number;
  latestTimestamp: number;
  payload: SignedGatewayEvent;
  updatedAtMs: number;
}

export interface OpenRailsProofEventMetadata {
  eventId: string;
  paycardId: string;
  eventType: SignedGatewayEvent["eventType"];
  sequence: number;
  timestamp: number;
  createdAtMs?: number;
  signaturePresent: boolean;
}

export interface OpenRailsProofExplorerLinks {
  package: string;
  paycard: string;
  terminalReceipt?: string;
}

export interface OpenRailsProofTrustBoundaryLabel {
  id: OpenRailsProofBoundary;
  label: string;
  authority: "sui" | "gateway" | "receipt-index";
  description: string;
}

export interface OpenRailsProofV1_1 {
  schemaVersion: OpenRailsProofSchemaVersion;
  protocolVersion: OpenRailsProtocolVersion;
  packageId: string;
  paycardId: string;
  status: OpenRailsProofStatus;
  latestStreamState: OpenRailsProofStreamState | null;
  recentStreamEvents: OpenRailsProofEventMetadata[];
  terminalReceipt: IndexedSettlementReceiptV1 | null;
  explorerLinks: OpenRailsProofExplorerLinks;
  trustBoundaries: OpenRailsProofTrustBoundaryLabel[];
}

export interface BuildSuiExplorerLinksParams {
  network?: "mainnet" | "testnet" | "devnet" | "localnet" | string;
  packageId: string;
  paycardId: string;
  transactionDigest?: string;
}

export interface BuildOpenRailsProofParams extends BuildSuiExplorerLinksParams {
  latestStreamState?: OpenRailsProofStreamState | null;
  recentStreamEvents?: OpenRailsProofEventMetadata[];
  terminalReceipt?: IndexedSettlementReceiptV1 | null;
}

export function isValidSuiId(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value);
}

function explorerNetworkSuffix(network: string | undefined): string {
  return network && network !== "mainnet" ? `?network=${encodeURIComponent(network)}` : "";
}

export function buildSuiExplorerLinks(params: BuildSuiExplorerLinksParams): OpenRailsProofExplorerLinks {
  const suffix = explorerNetworkSuffix(params.network);
  return {
    package: `https://suiexplorer.com/object/${params.packageId}${suffix}`,
    paycard: `https://suiexplorer.com/object/${params.paycardId}${suffix}`,
    ...(params.transactionDigest
      ? { terminalReceipt: `https://suiexplorer.com/txblock/${params.transactionDigest}${suffix}` }
      : {}),
  };
}

export function gatewayEventMetadata(event: {
  eventId: string;
  paycardId: string;
  eventType: SignedGatewayEvent["eventType"];
  sequence: number;
  timestamp: number;
  payload?: { signature?: string };
  createdAtMs?: number;
}): OpenRailsProofEventMetadata {
  return {
    eventId: event.eventId,
    paycardId: event.paycardId,
    eventType: event.eventType,
    sequence: event.sequence,
    timestamp: event.timestamp,
    ...(event.createdAtMs === undefined ? {} : { createdAtMs: event.createdAtMs }),
    signaturePresent: typeof event.payload?.signature === "string" && event.payload.signature.length > 0,
  };
}

export function buildOpenRailsProof(params: BuildOpenRailsProofParams): OpenRailsProofV1_1 {
  const terminalReceipt = params.terminalReceipt ?? null;
  const latestStreamState = params.latestStreamState ?? null;

  return {
    schemaVersion: OPENRAILS_PROOF_SCHEMA_VERSION_V1_1,
    protocolVersion: OPENRAILS_PROTOCOL_VERSION_V1_1,
    packageId: params.packageId,
    paycardId: params.paycardId,
    status: terminalReceipt ? "settled" : "active",
    latestStreamState,
    recentStreamEvents: params.recentStreamEvents ?? [],
    terminalReceipt,
    explorerLinks: buildSuiExplorerLinks({
      network: params.network,
      packageId: params.packageId,
      paycardId: params.paycardId,
      transactionDigest: terminalReceipt?.transactionDigest,
    }),
    trustBoundaries: [
      {
        id: "sui_package",
        label: "Sui package",
        authority: "sui",
        description: "Package ID identifies the deployed OpenRails Move modules.",
      },
      {
        id: "sui_paycard",
        label: "Paycard object",
        authority: "sui",
        description: "Paycard ID identifies the stream object on Sui.",
      },
      {
        id: "gateway_projection",
        label: "Gateway projection",
        authority: "gateway",
        description: latestStreamState
          ? "Latest stream state is a signed off-chain projection for UX and webhooks."
          : "No gateway projection is indexed for this Paycard.",
      },
      {
        id: "settlement_receipt",
        label: "Terminal receipt",
        authority: "receipt-index",
        description: terminalReceipt
          ? "SettlementReceipt is the authoritative terminal accounting proof."
          : "No terminal SettlementReceipt is indexed for this Paycard.",
      },
    ],
  };
}
