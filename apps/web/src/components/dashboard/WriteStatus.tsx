import type { WriteStatus } from "../../hooks/useChannelWrite";
import { SUI_NETWORK, explorerTxUrl } from "../../config";

function fmtSui(mist: bigint): string {
  const whole = mist / 1_000_000_000n;
  const frac = (mist % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function WriteStatusView({ status }: { status: WriteStatus }) {
  switch (status.kind) {
    case "idle":
      return null;
    case "disconnected":
      return <div className="write-status warn">Connect a wallet to continue.</div>;
    case "wrong-network":
      return <div className="write-status warn">Wrong network — switch your wallet to <b>{SUI_NETWORK}</b>.</div>;
    case "insufficient-balance":
      return (
        <div className="write-status warn">
          Insufficient SUI to fund: need <b>◎ {fmtSui(status.need)}</b>, have <b>◎ {fmtSui(status.have)}</b>. Faucet testnet SUI and retry.
        </div>
      );
    case "pending-signature":
      return <div className="write-status info"><span className="spin" aria-hidden="true" />Approve in your wallet…</div>;
    case "submitted":
      return <div className="write-status info"><span className="spin" aria-hidden="true" />Submitted · finalizing…</div>;
    case "finalizing":
      return <div className="write-status info"><span className="spin" aria-hidden="true" />Finalizing on-chain…</div>;
    case "confirmed":
      return (
        <div className="write-status ok">
          Confirmed. <a href={explorerTxUrl(status.digest)} target="_blank" rel="noreferrer">View transaction →</a>
        </div>
      );
    case "stale-nonce":
      return <div className="write-status warn">Nonce was stale and was retried. If it persists, reload the page.</div>;
    case "rejected":
      return <div className="write-status warn">Signature rejected in the wallet.</div>;
    case "failed":
      return <div className="write-status err">Failed: {status.message}</div>;
    default:
      return null;
  }
}
