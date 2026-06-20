import type {
  ActivityEvent,
  CreatePreview,
  LifecycleStep,
  MockWeb3State,
  NavItem,
  ProofCard,
  ScenarioState,
  StatusMatrixItem,
  StreamDetail,
} from "../types/dashboard";

export type StreamStatus = "active" | "pending" | "settled" | "warning";

export interface Metric {
  label: string;
  value: string;
  helper: string;
  trend: string;
  tone?: "blue" | "green" | "violet" | "amber";
  dominant?: boolean;
}

export interface Stream {
  id: string;
  label: string;
  counterparty: string;
  type: "RailsCard" | "RailsFlow";
  status: StreamStatus;
  rate: string;
  accrued: string;
  remaining: string;
  metadata: string;
  receipt: string;
  region: "Payer client" | "Sui object" | "Gateway projection" | "Receipt index";
  asOf: string;
}

export interface Receipt {
  id: string;
  type: "depleted" | "expired" | "cancelled";
  paid: string;
  residual: string;
  digest: string;
  label: string;
  /* enriched detail (present from live Worker + mock fixtures) */
  paycardId?: string;
  payer?: string;
  recipient?: string;
  initial?: string;
  paidMist?: string;
  residualMist?: string;
  initialMist?: string;
  closedAt?: string;
  txDigest?: string;
  explorerHref?: string;
}

export interface AssetBalance {
  symbol: string;
  name: string;
  balance: string;
  change: string;
  tone: "blue" | "green" | "violet";
}

export interface VelocityPoint {
  label: string;
  value: number;
}

export interface ProofLink {
  label: string;
  detail: string;
  href?: string;
}

export const mockDataMeta = {
  source: "OpenRails Worker plus static product copy",
  asOf: "Live dashboard data loads from the public Worker",
  network: "Sui Testnet references only",
  liveIntegrations: "wallet writes and Walrus uploads disabled; Worker receipt and stream reads enabled",
};

export const cockpitProof = {
  railId: "0x1809f38156fb5f27",
  envelope: "openrails.v1_1.channel",
  walrusBlob: "reference only",
  paycardId: "0x1809...e627",
  receiptDigest: "FruqXUh...EpSM",
  proofState: "Worker projected, terminal receipts indexed",
  boundary: "Projection is UX-only. SettlementReceipt events are authoritative.",
};

export const metrics: Metric[] = [
  { label: "Settled by receipt", value: "147", helper: "terminal events available in the mock receipt ledger", trend: "+9 indexed", tone: "blue", dominant: true },
  { label: "Active rails", value: "18", helper: "12 RailsCard, 6 RailsFlow", trend: "+24%", tone: "green" },
  { label: "Vault liquidity", value: "4.82 SUI", helper: "SealedVault funds across demo streams", trend: "+0.38", tone: "violet" },
  { label: "Encrypted links", value: "63", helper: "Walrus ciphertext blobs with fragment keys", trend: "0 leaks", tone: "amber" },
];

export const assetBalances: AssetBalance[] = [
  { symbol: "SUI", name: "Vault liquidity", balance: "4.82", change: "+8.6%", tone: "blue" },
  { symbol: "OR", name: "OpenRails demo volume", balance: "147", change: "+9 receipts", tone: "green" },
  { symbol: "WAL", name: "Encrypted blobs", balance: "63", change: "private by fragment", tone: "violet" },
];

export const velocity: VelocityPoint[] = [
  { label: "Mon", value: 34 },
  { label: "Tue", value: 58 },
  { label: "Wed", value: 46 },
  { label: "Thu", value: 72 },
  { label: "Fri", value: 64 },
  { label: "Sat", value: 88 },
  { label: "Sun", value: 76 },
];

export const streams: Stream[] = [
  {
    id: "0xf2da...58cc",
    label: "GPU agent compute",
    counterparty: "Node supplier",
    type: "RailsCard",
    status: "active",
    rate: "0.0001 SUI/s",
    accrued: "0.0011 SUI",
    remaining: "0.0189 SUI",
    metadata: "Encrypted Walrus",
    receipt: "pending",
    region: "Gateway projection",
    asOf: "10s ago",
  },
  {
    id: "0x9a31...e015",
    label: "API usage invoice",
    counterparty: "Inference API",
    type: "RailsFlow",
    status: "pending",
    rate: "0.0004 SUI/s",
    accrued: "awaiting fund",
    remaining: "0.1200 SUI",
    metadata: "Signed permit",
    receipt: "not started",
    region: "Payer client",
    asOf: "awaiting funding",
  },
  {
    id: "0x6db7...990a",
    label: "Creator access pass",
    counterparty: "Media vault",
    type: "RailsCard",
    status: "warning",
    rate: "0.0002 SUI/s",
    accrued: "0.0360 SUI",
    remaining: "0.0040 SUI",
    metadata: "Fragment key held",
    receipt: "buffer low",
    region: "Gateway projection",
    asOf: "14m ago",
  },
  {
    id: "0x41ee...a77b",
    label: "Merchant checkout",
    counterparty: "Storefront",
    type: "RailsFlow",
    status: "settled",
    rate: "completed",
    accrued: "0.1050 SUI",
    remaining: "0.0000 SUI",
    metadata: "Blob anchored",
    receipt: "indexed",
    region: "Receipt index",
    asOf: "2m ago",
  },
];

export const receipts: Receipt[] = [
  {
    id: "evt-0",
    label: "Merchant checkout",
    type: "depleted",
    paid: "0.1050 SUI",
    residual: "0.0000 SUI",
    digest: "C5As...Lsmo",
    paycardId: "0x41ee...a77b",
    payer: "0x3056...d993",
    recipient: "0x41ee...a77b",
    initial: "0.1050 SUI",
    paidMist: "105000000",
    residualMist: "0",
    initialMist: "105000000",
    closedAt: "2m ago",
    txDigest: "C5AsLsmo",
    explorerHref: "https://suiexplorer.com/txblock/C5AsLsmo?network=testnet",
  },
  {
    id: "evt-1",
    label: "Creator access pass",
    type: "expired",
    paid: "0.0892 SUI",
    residual: "0.0108 SUI",
    digest: "Fruq...EpSM",
    paycardId: "0x6db7...990a",
    payer: "0x3056...d993",
    recipient: "0x6db7...990a",
    initial: "0.1000 SUI",
    paidMist: "89200000",
    residualMist: "10800000",
    initialMist: "100000000",
    closedAt: "14m ago",
    txDigest: "FruqEpSM",
    explorerHref: "https://suiexplorer.com/txblock/FruqEpSM?network=testnet",
  },
  {
    id: "evt-2",
    label: "Recovery path",
    type: "cancelled",
    paid: "0.0000 SUI",
    residual: "0.0500 SUI",
    digest: "AuvE...vRge",
    paycardId: "0x9a31...e015",
    payer: "0xf2da...58cc",
    recipient: "0x9a31...e015",
    initial: "0.0500 SUI",
    paidMist: "0",
    residualMist: "50000000",
    initialMist: "50000000",
    closedAt: "1h ago",
    txDigest: "AuvEvRge",
    explorerHref: "https://suiexplorer.com/txblock/AuvEvRge?network=testnet",
  },
];

export const proofStats = [
  "Sui testnet package live",
  "Fresh active channels live",
  "Gateway heartbeats indexed",
  "Receipt API wired into dashboard",
];

export const proofLinks: ProofLink[] = [
  {
    label: "Fresh RailsCard",
    detail: "0x1809...e627",
    href: "https://suiexplorer.com/object/0x1809f38156fb5f2724708523ebcce13f04c8bda613c9e9b87ed8ace9b632e627?network=testnet",
  },
  {
    label: "Fresh RailsFlow",
    detail: "0x698c...5f2a",
    href: "https://suiexplorer.com/object/0x698ccb11cf64a75f6d09e21cb09275a0d5631fe72992c62f23875f0e0eca5f2a?network=testnet",
  },
  {
    label: "Worker receipts",
    detail: "3 indexed",
    href: "https://openrails-receipt-api.microcosm.workers.dev/v1/receipts",
  },
];

export const dashboardNav: NavItem[] = [
  { route: "overview", label: "Overview", icon: "◌", group: "control" },
  { route: "create", label: "Create", icon: "+", group: "control" },
  { route: "streams", label: "Streams", icon: "⇄", group: "control" },
  { route: "gateway", label: "Gateway", icon: "⌁", group: "infrastructure" },
  { route: "receipts", label: "Receipts", icon: "✓", group: "infrastructure" },
  { route: "proof", label: "Proof", icon: "◎", group: "infrastructure" },
  { route: "settings", label: "Settings", icon: "⚙", group: "utility" },
];

export const lifecycleSteps: LifecycleStep[] = [
  {
    label: "01",
    title: "Signed link terms",
    description: "Canonical permission envelope binds payment terms before any future wallet action.",
    boundary: "user",
  },
  {
    label: "02",
    title: "SealedVault state",
    description: "Sui objects define the funded rail. This dashboard does not submit writes.",
    boundary: "sui",
  },
  {
    label: "03",
    title: "Gateway projection",
    description: "Signed heartbeats estimate accrual for UX and webhook-style views.",
    boundary: "gateway",
  },
  {
    label: "04",
    title: "Terminal receipt",
    description: "SettlementReceipt events are the authoritative accounting source.",
    boundary: "receipt",
  },
];

export const statusMatrix: StatusMatrixItem[] = [
  { label: "Dashboard mode", state: "Live Worker", detail: "Stream and receipt surfaces query the deployed Worker.", status: "ready" },
  { label: "Wallet signing", state: "Not connected", detail: "No signature prompts", status: "blocked" },
  { label: "Sui writes", state: "Not connected", detail: "No transactions submitted", status: "blocked" },
  { label: "Receipt API", state: "Connected", detail: "Dashboard calls the Worker receipt index.", status: "ready" },
  { label: "Testnet proof", state: "Available", detail: "Explorer links provided", status: "ready" },
  { label: "Walrus metadata", state: "Reference", detail: "Encrypted blob proven", status: "ready" },
];

export const activityEvents: ActivityEvent[] = [
  {
    id: "act-1",
    title: "Settlement receipt indexed",
    description: "Merchant checkout closed with depleted receipt proof.",
    time: "2m ago",
    status: "success",
    route: "receipts",
  },
  {
    id: "act-2",
    title: "Gateway projection sampled",
    description: "Mock heartbeat refreshed for active RailsCard stream.",
    time: "8m ago",
    status: "info",
    route: "gateway",
  },
  {
    id: "act-3",
    title: "Buffer low warning",
    description: "Creator access pass is nearing terminal settlement.",
    time: "14m ago",
    status: "warning",
    route: "streams",
  },
];

export const streamDetails: StreamDetail[] = streams.map((stream) => ({
  ...stream,
  terms: stream.type === "RailsCard" ? "Grant spend rate capped by SealedVault balance." : "Merchant invoice accrues after funding state is satisfied.",
  payer: stream.type === "RailsCard" ? "0x3056...d993" : "0xf2da...58cc",
  recipient: stream.counterparty,
  projectionSource: "Mock gateway heartbeat, not final settlement",
  safetyNote: "Preview data only. No Sui transaction, Walrus upload, or receipt API call is made by this UI.",
  receiptDigest: stream.receipt === "indexed" ? "C5As...Lsmo" : undefined,
}));

export const createPreviews: CreatePreview[] = [
  {
    kind: "railscard",
    title: "Preview RailsCard grant",
    subtitle: "Outbound payment link backed by a SealedVault and encrypted metadata.",
    steps: ["Define terms", "Preview envelope", "Seal vault", "Encrypt link", "Expect receipt"],
    previewRows: [
      { label: "What user signs", value: "Canonical permission envelope" },
      { label: "What moves onchain", value: "Future SealedVault funding only" },
      { label: "What stays private", value: "Fragment key and link metadata" },
      { label: "Final proof", value: "SettlementReceipt event" },
    ],
  },
  {
    kind: "railsflow",
    title: "Preview RailsFlow invoice",
    subtitle: "Merchant invoice with signed terms, funding state, and receipt-backed settlement.",
    steps: ["Define invoice", "Preview envelope", "Await funding", "Project accrual", "Verify receipt"],
    previewRows: [
      { label: "What user signs", value: "Invoice terms envelope" },
      { label: "What moves onchain", value: "Future payer funding only" },
      { label: "What gateway shows", value: "Off-chain accrual projection" },
      { label: "Final proof", value: "Depleted, expired, or cancelled receipt" },
    ],
  },
];

export const proofCards: ProofCard[] = [
  {
    id: "proof-mint",
    title: "Fresh RailsCard paycard",
    detail: "Current non-exhausted RailsCard object from the refreshed showcase.",
    status: "real-testnet",
    href: "https://suiexplorer.com/object/0x1809f38156fb5f2724708523ebcce13f04c8bda613c9e9b87ed8ace9b632e627?network=testnet",
  },
  {
    id: "proof-claim",
    title: "Fresh RailsFlow paycard",
    detail: "Current non-exhausted RailsFlow object from the refreshed showcase.",
    status: "real-testnet",
    href: "https://suiexplorer.com/object/0x698ccb11cf64a75f6d09e21cb09275a0d5631fe72992c62f23875f0e0eca5f2a?network=testnet",
  },
  {
    id: "proof-walrus",
    title: "Encrypted Walrus blob",
    detail: "bmKKhBQ_DKCMv0FldX7FlSnsh-tx9i3cWMNoynWdy-U",
    status: "reference",
  },
  {
    id: "proof-api",
    title: "Receipt API",
    detail: "Dashboard calls the deployed Worker for receipts and stream projections.",
    status: "real-testnet",
    href: "https://openrails-receipt-api.microcosm.workers.dev/v1/receipts",
  },
];

export const scenarioOptions: Array<{ value: ScenarioState; label: string; description: string }> = [
  { value: "normal", label: "Normal", description: "Show live Worker data when available." },
  { value: "loading", label: "Loading", description: "Preview Worker API loading states." },
  { value: "empty", label: "Empty", description: "Preview no-data guidance." },
  { value: "error", label: "Error", description: "Preview recoverable Worker API error copy." },
];

export const web3StateOptions: Array<{ value: MockWeb3State; label: string; description: string }> = [
  { value: "disconnected", label: "Disconnected", description: "No wallet connected to the dashboard." },
  { value: "wrong-network", label: "Wrong network", description: "Future wallet is not on Sui Testnet." },
  { value: "pending-signature", label: "Pending signature", description: "Future wallet confirmation would be required." },
  { value: "pending-confirmation", label: "Pending confirmation", description: "Future Sui transaction would be awaiting finality." },
  { value: "confirmed", label: "Confirmed", description: "Future transaction would reveal a receipt." },
  { value: "failed", label: "Failed", description: "Future transaction or indexing error state." },
];
