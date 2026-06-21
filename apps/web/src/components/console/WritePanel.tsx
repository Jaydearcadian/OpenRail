import { useState } from "react";
import { useChannelWrite, type WriteStatus } from "../../hooks/useChannelWrite";
import { ConnectMenu } from "../../wallet/ConnectMenu";
import { explorerObjectUrl, explorerTxUrl, SUI_NETWORK } from "../../config";

function suiToMist(input: string): bigint | null {
  const v = input.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt((frac + "000000000").slice(0, 9));
}

function fmtSui(mist: bigint): string {
  const whole = mist / 1_000_000_000n;
  const frac = (mist % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function StatusLine({ status }: { status: WriteStatus }) {
  switch (status.kind) {
    case "idle": return null;
    case "disconnected": return <div className="status-line warn">connect a wallet to continue</div>;
    case "wrong-network": return <div className="status-line warn">wrong network — switch your wallet to {SUI_NETWORK}</div>;
    case "insufficient-balance": return <div className="status-line warn">insufficient SUI: need ◎{fmtSui(status.need)}, have ◎{fmtSui(status.have)} · faucet testnet SUI</div>;
    case "pending-signature": return <div className="status-line info"><span className="spin" />approve in your wallet…</div>;
    case "submitted": return <div className="status-line info"><span className="spin" />submitted · finalizing…</div>;
    case "finalizing": return <div className="status-line info"><span className="spin" />finalizing on-chain…</div>;
    case "confirmed": return <div className="status-line ok">confirmed · <a href={explorerTxUrl(status.digest)} target="_blank" rel="noreferrer">view tx →</a></div>;
    case "stale-nonce": return <div className="status-line warn">nonce was stale — retried</div>;
    case "rejected": return <div className="status-line warn">signature rejected</div>;
    case "failed": return <div className="status-line err">failed: {status.message}</div>;
    default: return null;
  }
}

export function WritePanel() {
  const w = useChannelWrite();
  const [amount, setAmount] = useState("0.05");
  const [rate, setRate] = useState("500000");
  const [duration, setDuration] = useState("120");
  const [recipient, setRecipient] = useState("");
  const [recovery, setRecovery] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"cancel" | "resolve" | null>(null);

  if (!w.connected) {
    return (
      <div className="panel">
        <div className="ph"><h3>✎ open a rail</h3></div>
        <div className="pb gate">
          <p>connect a Sui wallet or sign in with Google (zkLogin) to open a real streaming channel. gas is sponsored for zkLogin; funding still uses your SUI.</p>
          <ConnectMenu />
        </div>
      </div>
    );
  }

  const self = w.address ?? "";
  const busy = ["pending-signature", "submitted", "finalizing"].includes(w.status.kind);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreated(null);
    const amt = suiToMist(amount);
    const rateMist = /^\d+$/.test(rate.trim()) ? BigInt(rate.trim()) : null;
    const dur = /^\d+$/.test(duration.trim()) ? Number(duration.trim()) : NaN;
    if (amt === null || rateMist === null || Number.isNaN(dur)) return;
    const result = await w.open({ amount: amt, rate: rateMist, recipient: recipient.trim() || self, durationSeconds: dur, recovery: recovery.trim() || self });
    if (result?.paycardId) setCreated(result.paycardId);
  };

  const lifecycle = async (action: "claim" | "cancel" | "resolve") => {
    if (!created) return;
    if ((action === "cancel" || action === "resolve") && confirm !== action) { setConfirm(action); return; }
    setConfirm(null);
    await w[action](created);
  };

  return (
    <div className="panel">
      <div className="ph"><h3>✎ open a rail · {w.onNetwork ? "live" : "wrong network"}</h3><span className="mono mut" style={{ fontSize: 11 }}>{self.slice(0, 8)}…{self.slice(-4)}</span></div>
      <div className="pb">
        <form className="form" onSubmit={submit}>
          <label>allocation (SUI)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
          <label>rate (MIST/sec)<input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="numeric" /></label>
          <label>duration (sec)<input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" /></label>
          <label>recipient<input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="you" /></label>
          <label className="full">recovery target<input value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="you" /></label>
          <button type="submit" className="btn btn-primary" disabled={busy}>open channel →</button>
        </form>

        <StatusLine status={w.status} />

        {created ? (
          <div>
            <div className="section-label">channel opened</div>
            <div className="linkout"><span className="k">{created}</span></div>
            <a className="mono" style={{ color: "var(--blue)", fontSize: 12 }} href={explorerObjectUrl(created)} target="_blank" rel="noreferrer">view paycard in explorer →</a>
            <div className="actions-row">
              <button type="button" className="btn btn-ghost" onClick={() => lifecycle("claim")}>claim accrued</button>
              <button type="button" className="btn btn-ghost" onClick={() => lifecycle("cancel")}>{confirm === "cancel" ? "confirm cancel" : "cancel"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => lifecycle("resolve")}>{confirm === "resolve" ? "confirm resolve" : "resolve"}</button>
            </div>
            {confirm ? <div className="warn-row">⚠ irreversible on-chain settlement — pays accrued value and routes residual via STN-Delta.</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
