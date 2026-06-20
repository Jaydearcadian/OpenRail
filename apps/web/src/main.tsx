import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SuiClientProvider, WalletProvider, useSuiClient } from "@mysten/dapp-kit";
import { registerEnokiWallets } from "@mysten/enoki";
import { getFullnodeUrl } from "@mysten/sui/client";
import "@mysten/dapp-kit/dist/index.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-700.css";
import App from "./App";
import "./stream.css";
import {
  SUI_NETWORK,
  ENOKI_ENABLED,
  ENOKI_API_KEY,
  GOOGLE_CLIENT_ID,
  FACEBOOK_CLIENT_ID,
  TWITCH_CLIENT_ID,
  ENOKI_REDIRECT_URL,
} from "./config";

const queryClient = new QueryClient();

const networks = {
  testnet: { url: getFullnodeUrl("testnet") },
  mainnet: { url: getFullnodeUrl("mainnet") },
};

/** Registers Enoki zkLogin wallets (gated on config) into the wallet-standard registry. */
function EnokiRegistrar() {
  const client = useSuiClient();

  useEffect(() => {
    if (!ENOKI_ENABLED) return;
    const providers: Record<string, { clientId: string; redirectUrl?: string }> = {};
    if (GOOGLE_CLIENT_ID) providers.google = { clientId: GOOGLE_CLIENT_ID, redirectUrl: ENOKI_REDIRECT_URL };
    if (FACEBOOK_CLIENT_ID) providers.facebook = { clientId: FACEBOOK_CLIENT_ID, redirectUrl: ENOKI_REDIRECT_URL };
    if (TWITCH_CLIENT_ID) providers.twitch = { clientId: TWITCH_CLIENT_ID, redirectUrl: ENOKI_REDIRECT_URL };

    const { unregister } = registerEnokiWallets({
      apiKey: ENOKI_API_KEY,
      providers,
      client,
      network: SUI_NETWORK,
    } as unknown as Parameters<typeof registerEnokiWallets>[0]);
    return unregister;
  }, [client]);

  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork={SUI_NETWORK}>
        <EnokiRegistrar />
        <WalletProvider autoConnect>
          <App />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
);
