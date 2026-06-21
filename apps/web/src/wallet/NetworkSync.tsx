import { useContext, useEffect } from "react";
import { SuiClientContext } from "@mysten/dapp-kit";
import { SUI_NETWORK } from "../config";

/**
 * Keeps the app's Sui client on the target network (testnet). This is the
 * "automatic" half; the ConnectMenu exposes an explicit "Switch to Sui testnet"
 * control for the manual case and surfaces a warning when a connected wallet
 * doesn't support the target chain.
 */
export function NetworkSync() {
  const ctx = useContext(SuiClientContext);

  useEffect(() => {
    if (ctx && ctx.network !== SUI_NETWORK) ctx.selectNetwork(SUI_NETWORK);
  }, [ctx]);

  return null;
}
