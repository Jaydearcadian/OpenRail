import { useContext, useEffect, useState } from "react";
import { useCurrentAccount, SuiClientContext } from "@mysten/dapp-kit";

export function NetworkSync() {
  const account = useCurrentAccount();
  const ctx = useContext(SuiClientContext);
  const [wrongNet, setWrongNet] = useState(false);

  useEffect(() => {
    if (!ctx) return;
    ctx.selectNetwork("testnet");
  }, [ctx]);

  useEffect(() => {
    if (!account) { setWrongNet(false); return; }
    const onTestnet = account.chains.some((c) => c === "sui:testnet");
    setWrongNet(!onTestnet);
  }, [account]);

  if (!wrongNet) return null;

  return (
    <div style={{
      position: "fixed", bottom: 12, left: "50%", transform: "translateX(-50%)",
      background: "#c0392b", color: "#fff", padding: "8px 16px",
      borderRadius: 4, fontSize: 13, fontFamily: "var(--font-mono, monospace)",
      zIndex: 9999, pointerEvents: "none",
    }}>
      wallet is on wrong network — switch to Sui Testnet
    </div>
  );
}
