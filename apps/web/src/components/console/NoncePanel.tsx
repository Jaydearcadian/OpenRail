import { useEffect, useState } from "react";
import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { createNonceEngine } from "@openrails/sdk";
import { OPENRAILS_PACKAGE_ID, SUI_NETWORK } from "../../config";

function nonceKey(address: string): string {
  return `openrails:nonceAccount:${SUI_NETWORK}:${OPENRAILS_PACKAGE_ID}:${address}`;
}

export function NoncePanel() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const [lanes, setLanes] = useState<{ channel: number; next: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accountId = account && typeof localStorage !== "undefined" ? localStorage.getItem(nonceKey(account.address)) : null;

  useEffect(() => {
    if (!account || !accountId) return;
    let cancelled = false;
    setError(null);
    const engine = createNonceEngine({ client, packageId: OPENRAILS_PACKAGE_ID, payer: account.address, nonceAccountId: accountId });
    (async () => {
      try {
        const out: { channel: number; next: string }[] = [];
        for (let c = 0; c < 4; c += 1) {
          const value = await engine.peek({ nonceChannel: BigInt(c) });
          out.push({ channel: c, next: value.toString() });
        }
        if (!cancelled) setLanes(out);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [account?.address, accountId, client]);

  return (
    <div className="panel">
      <div className="ph"><h3>⟨⟩ nonce lanes</h3>{accountId ? <span className="mono mut" style={{ fontSize: 11 }}>{accountId.slice(0, 8)}…{accountId.slice(-4)}</span> : null}</div>
      {!account ? (
        <div className="dt-empty">connect a wallet to view your nonce lanes</div>
      ) : !accountId ? (
        <div className="dt-empty">no nonce account yet — open a rail to create one (it caches per browser)</div>
      ) : error ? (
        <div className="dt-empty">{error}</div>
      ) : (
        <table className="dt">
          <thead><tr><th>lane (channel)</th><th className="num">next nonce</th></tr></thead>
          <tbody>
            {(lanes ?? []).map((l) => (
              <tr key={l.channel} className="static"><td className="id">{l.channel}</td><td className="num">{l.next}</td></tr>
            ))}
            {lanes === null ? <tr className="static"><td colSpan={2} className="dt-empty">reading on-chain…</td></tr> : null}
          </tbody>
        </table>
      )}
    </div>
  );
}
