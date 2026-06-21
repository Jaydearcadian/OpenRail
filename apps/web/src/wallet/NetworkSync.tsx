import { useContext, useEffect } from "react";
import { useCurrentAccount, SuiClientContext } from "@mysten/dapp-kit";

/** Reads the connected wallet's declared chain and syncs SuiClientProvider to match. */
export function NetworkSync() {
  const account = useCurrentAccount();
  const ctx = useContext(SuiClientContext);

  useEffect(() => {
    if (!account || !ctx) return;
    for (const chain of account.chains) {
      if (chain === "sui:testnet") { ctx.selectNetwork("testnet"); return; }
      if (chain === "sui:mainnet") { ctx.selectNetwork("mainnet"); return; }
    }
  }, [account, ctx]);

  return null;
}
