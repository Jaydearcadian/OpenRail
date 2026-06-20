import { useState } from "react";
import { useChannelWrite } from "../../hooks/useChannelWrite";
import { WriteStatusView } from "./WriteStatus";
import { ConnectMenu } from "../../wallet/ConnectMenu";
import { explorerObjectUrl } from "../../config";

function suiToMist(input: string): bigint | null {
  const v = input.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt((frac + "000000000").slice(0, 9));
}

export function WriteSurface() {
  const w = useChannelWrite();
  const [amount, setAmount] = useState("0.05");
  const [rate, setRate] = useState("500000"); // MIST/sec
  const [duration, setDuration] = useState("120");
  const [recipient, setRecipient] = useState("");
  const [recovery, setRecovery] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"cancel" | "resolve" | null>(null);

  if (!w.connected) {
    return (
      <section className="panel write-panel" aria-labelledby="write-title">
        <div className="panel-heading compact">
          <span>✎ Public write</span>
          <h2 id="write-title">Open a rail</h2>
        </div>
        <p>Connect a Sui wallet or sign in with Google (zkLogin) to open a real streaming channel. Gas is sponsored for zkLogin; funding the channel still uses your SUI.</p>
        <div style={{ marginTop: 16 }}><ConnectMenu /></div>
      </section>
    );
  }

  const self = w.address ?? "";
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreated(null);
    const amt = suiToMist(amount);
    const rateMist = /^\d+$/.test(rate.trim()) ? BigInt(rate.trim()) : null;
    const dur = /^\d+$/.test(duration.trim()) ? Number(duration.trim()) : NaN;
    if (amt === null || rateMist === null || Number.isNaN(dur)) return;

    const result = await w.open({
      amount: amt,
      rate: rateMist,
      recipient: recipient.trim() || self,
      durationSeconds: dur,
      recovery: recovery.trim() || self,
    });
    if (result?.paycardId) setCreated(result.paycardId);
  };

  const runLifecycle = async (action: "claim" | "cancel" | "resolve") => {
    if (!created) return;
    if ((action === "cancel" || action === "resolve") && confirmAction !== action) {
      setConfirmAction(action);
      return;
    }
    setConfirmAction(null);
    await w[action](created);
  };

  return (
    <section className="panel write-panel" aria-labelledby="write-title">
      <div className="panel-heading">
        <div>
          <span>✎ Public write · {w.onNetwork ? "live" : "wrong network"}</span>
          <h2 id="write-title">Open a rail</h2>
        </div>
        <ConnectMenu />
      </div>

      <form className="write-form" onSubmit={submit}>
        <label>Allocation (SUI)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
        <label>Rate (MIST / sec)<input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="numeric" /></label>
        <label>Duration (seconds)<input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" /></label>
        <label>Recipient<input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={`${self.slice(0, 10)}… (you)`} /></label>
        <label>Recovery target<input value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder={`${self.slice(0, 10)}… (you)`} /></label>
        <button type="submit" className="btn btn-primary" disabled={["pending-signature", "submitted", "finalizing"].includes(w.status.kind)}>
          Open channel
        </button>
      </form>

      <WriteStatusView status={w.status} />

      {created ? (
        <div className="write-created">
          <div className="inspect-section-label">Channel opened</div>
          <div className="linkout"><span className="k">{created}</span></div>
          <a className="explorer-link" href={explorerObjectUrl(created)} target="_blank" rel="noreferrer">View paycard in explorer →</a>
          <div className="write-actions">
            <button type="button" className="ghost-button" onClick={() => runLifecycle("claim")}>Claim accrued</button>
            <button type="button" className="ghost-button" onClick={() => runLifecycle("cancel")}>{confirmAction === "cancel" ? "Confirm cancel" : "Cancel"}</button>
            <button type="button" className="ghost-button" onClick={() => runLifecycle("resolve")}>{confirmAction === "resolve" ? "Confirm resolve" : "Resolve (expired)"}</button>
          </div>
          {confirmAction ? (
            <p className="write-warning">⚠ This is an irreversible on-chain settlement. It pays accrued value and routes residual via STN-Delta.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
