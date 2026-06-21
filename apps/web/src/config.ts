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

export function explorerObjectUrl(id: string): string {
  return `https://suiexplorer.com/object/${id}?network=${SUI_NETWORK}`;
}

export function explorerTxUrl(digest: string): string {
  return `https://suiexplorer.com/txblock/${digest}?network=${SUI_NETWORK}`;
}
