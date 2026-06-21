/**
 * Runtime config from Vite env. Secrets are provided by the operator via .env.local
 * (see .env.example) and are never committed. Wallet writes target the configured
 * OpenRails package; set VITE_OPENRAILS_PACKAGE_ID to the published V1.2 cut.
 */

type ViteEnv = Record<string, string | undefined>;
const env = ((import.meta as ImportMeta & { env?: ViteEnv }).env ?? {}) as ViteEnv;

export type SuiNetwork = "testnet" | "mainnet";

export const SUI_NETWORK: SuiNetwork = env.VITE_SUI_NETWORK === "mainnet" ? "mainnet" : "testnet";

/** OpenRails Move package id used for writes. Defaults to the V1.1 cut until V1.2 is published. */
export const OPENRAILS_PACKAGE_ID =
  env.VITE_OPENRAILS_PACKAGE_ID?.trim() ||
  "0x4a42fd8493d0929879b2cbd4e19226468867f2c4a4dece8a59d317911d172b2c";

// ── Enoki zkLogin (sponsored social onboarding) ──────────────────────────────
export const ENOKI_API_KEY = env.VITE_ENOKI_API_KEY?.trim() ?? "";
export const GOOGLE_CLIENT_ID = env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
export const FACEBOOK_CLIENT_ID = env.VITE_ENOKI_FACEBOOK_CLIENT_ID?.trim() ?? "";
export const TWITCH_CLIENT_ID = env.VITE_ENOKI_TWITCH_CLIENT_ID?.trim() ?? "";

/** True when an Enoki key + at least one OAuth provider are configured. */
export const ENOKI_ENABLED = Boolean(
  ENOKI_API_KEY && (GOOGLE_CLIENT_ID || FACEBOOK_CLIENT_ID || TWITCH_CLIENT_ID),
);

export const ENOKI_REDIRECT_URL = typeof window !== "undefined" ? window.location.origin : "";

export const SUI_COIN_TYPE = "0x2::sui::SUI";

// ── Project links (surfaced in landing / console / docs) ─────────────────────
export const GITHUB_REPO_URL = "https://github.com/Jaydearcadian/OpenRail";
export const GITHUB_DOCS_URL = `${GITHUB_REPO_URL}/tree/main/docs`;
export const GITHUB_SDK_URL = `${GITHUB_REPO_URL}/tree/main/sdk`;
export const CONSOLE_URL = "https://openrails-console.pages.dev";

/** Testnet faucet (operator can self-fund a zkLogin / wallet address). */
export const SUI_FAUCET_URL = "https://faucet.sui.io/?network=testnet";

/**
 * Gas sponsorship. When an Enoki (zkLogin) wallet is connected and an Enoki key
 * is configured, writes are routed through the Enoki sponsored-transaction API in
 * JWT mode: Enoki derives the sender from the authenticated Google identity, so
 * ANY signed-in Gmail user is sponsored with no per-user registration.
 *
 * NOTE: only gas is sponsored — the RailsCard allocation still comes from the
 * payer's own SUI. Sponsorship requires the Enoki portal (one-time setup) to
 * enable sponsored transactions on this network and allowlist the move-call
 * targets below. The targets are NOT sent from the client in JWT mode; paste
 * them into the portal's sponsorship allowlist instead.
 */
export const ENOKI_SPONSORED_WRITES = ENOKI_API_KEY.length > 0;

/** Paste these into the Enoki portal's sponsorship "allowed move-call targets". */
export const ENOKI_SPONSOR_TARGETS = [
  `${OPENRAILS_PACKAGE_ID}::paycard_v1::mint_and_fund_envelope`,
  `${OPENRAILS_PACKAGE_ID}::paycard_v1::claim_settlement_round`,
  `${OPENRAILS_PACKAGE_ID}::paycard_v1::cancel_paycard`,
  `${OPENRAILS_PACKAGE_ID}::paycard_v1::resolve_residual_delta_expiry`,
  `${OPENRAILS_PACKAGE_ID}::nonce_account::create_nonce_account`,
];

export function explorerObjectUrl(id: string): string {
  return `https://suiexplorer.com/object/${id}?network=${SUI_NETWORK}`;
}

export function explorerTxUrl(digest: string): string {
  return `https://suiexplorer.com/txblock/${digest}?network=${SUI_NETWORK}`;
}
