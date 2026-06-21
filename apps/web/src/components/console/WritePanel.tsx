import { useMemo, useState } from "react";
import { useChannelWrite, type WriteStatus } from "../../hooks/useChannelWrite";
import { ConnectMenu } from "../../wallet/ConnectMenu";
import { explorerObjectUrl, explorerTxUrl, SUI_NETWORK } from "../../config";
import { suiToMist, suiGlyph, humanRate, humanDuration } from "../../lib/format";
import { railCardUrl, railFlowUrl, type FlowTerms } from "../../lib/raillink";
import { ShareLink } from "./ShareLink";

type RailKind = "card" | "flow";

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
  const [kind, setKind] = useState<RailKind>("card");
  const [amount, setAmount] = useState("0.05");
  const [rate, setRate] = useState("0.0005");
  const [duration, setDuration] = useState("120");
  const [counterparty, setCounterparty] = useState("");
  const [recovery, setRecovery] = useState("");
  const [memo, setMemo] = useState("");
  const [created, setCreated] = useState<{ paycardId: string; link: string } | null>(null);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"cancel" | "resolve" | null>(null);

  // Live, human-readable preview of what these terms mean.
  const preview = useMemo(() => {
    const amt = suiToMist(amount);
    const rateMist = suiToMist(rate);
    const dur = /^\d+$/.test(duration.trim()) ? Number(duration.trim()) : NaN;
    if (amt === null || rateMist === null || Number.isNaN(dur)) return null;
    const streamed = rateMist * BigInt(dur);
    const fullyStreams = streamed >= amt;
    return {
      rate: humanRate(rateMist),
      duration: humanDuration(dur),
      total: suiGlyph(amt),
      streamed: suiGlyph(streamed > amt ? amt : streamed),
      fullyStreams,
    };
  }, [amount, rate, duration]);

  if (!w.connected) {
    return (
      <div className="panel">
        <div className="ph"><h3>✎ create a rail</h3></div>
        <div className="pb gate">
          <p>connect a Sui wallet or sign in with Google (zkLogin) to create a RailsCard grant or a RailsFlow invoice. gas is sponsored for zkLogin; funding still uses your SUI.</p>
          <ConnectMenu />
        </div>
      </div>
    );
  }

  const self = w.address ?? "";
  const busy = ["pending-signature", "submitted", "finalizing"].includes(w.status.kind);

  const reset = () => { setCreated(null); setInvoice(null); setConfirm(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    const amt = suiToMist(amount);
    const rateMist = suiToMist(rate);
    const dur = /^\d+$/.test(duration.trim()) ? Number(duration.trim()) : NaN;
    if (amt === null || rateMist === null || Number.isNaN(dur)) return;

    if (kind === "flow") {
      // Invoice: no on-chain tx by the merchant. Encode terms into a link the
      // payer opens to fund. The merchant (you) is the recipient.
      const terms: FlowTerms = {
        v: 1,
        kind: "flow",
        recipient: self,
        allocMist: amt.toString(),
        rateMist: rateMist.toString(),
        durationSec: dur,
        recovery: recovery.trim() || self,
        memo: memo.trim() || undefined,
      };
      setInvoice(railFlowUrl(terms));
      return;
    }

    // RailsCard: fund the Paycard now, then share a link to it.
    const result = await w.open({
      amount: amt,
      rate: rateMist,
      recipient: counterparty.trim() || self,
      durationSeconds: dur,
      recovery: recovery.trim() || self,
    });
    if (result?.paycardId) setCreated({ paycardId: result.paycardId, link: railCardUrl(result.paycardId) });
  };

  const lifecycle = async (action: "claim" | "cancel" | "resolve") => {
    if (!created) return;
    if ((action === "cancel" || action === "resolve") && confirm !== action) { setConfirm(action); return; }
    setConfirm(null);
    await w[action](created.paycardId);
  };

  const counterpartyLabel = kind === "card" ? "recipient (who claims)" : "payer (who funds)";

  return (
    <div className="panel">
      <div className="ph">
        <h3>✎ create a rail · {w.onNetwork ? "live" : "wrong network"}</h3>
        <span className="mono mut" style={{ fontSize: 11 }}>{self.slice(0, 8)}…{self.slice(-4)}</span>
      </div>
      <div className="pb">
        <div className="kseg" role="tablist">
          <button type="button" className={kind === "card" ? "on" : ""} onClick={() => { setKind("card"); reset(); }}>
            <div className="st">RailsCard</div>
            <div className="sd">outbound grant · you fund now, they claim</div>
          </button>
          <button type="button" className={kind === "flow" ? "on" : ""} onClick={() => { setKind("flow"); reset(); }}>
            <div className="st">RailsFlow</div>
            <div className="sd">inbound invoice · they fund, you get paid</div>
          </button>
        </div>

        <form className="form" onSubmit={submit}>
          <label>allocation (SUI)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
          <label>rate (SUI/sec)<input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" /></label>
          <label>duration (sec)<input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" /></label>
          <label>{counterpartyLabel}<input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder={kind === "card" ? "you" : "anyone with the link"} /></label>
          <label>recovery target<input value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="you" /></label>
          {kind === "flow" ? (
            <label>memo (optional)<input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="invoice #1024" /></label>
          ) : null}
          <button type="submit" className="btn btn-primary full" disabled={busy}>
            {kind === "card" ? "open channel & get link →" : "generate invoice link →"}
          </button>
        </form>

        {preview ? (
          <div className="terms-preview">
            <div className="tp-row"><span>flow rate</span><b>{preview.rate}</b></div>
            <div className="tp-row"><span>over</span><b>{preview.duration}</b></div>
            <div className="tp-row"><span>allocation</span><b>{preview.total}</b></div>
            <div className="tp-row">
              <span>{preview.fullyStreams ? "fully streams" : "streams"}</span>
              <b>{preview.streamed}{preview.fullyStreams ? " (caps at allocation)" : " · residual returns to recovery"}</b>
            </div>
          </div>
        ) : null}

        <StatusLine status={w.status} />

        {created ? (
          <div>
            <div className="section-label">RailsCard opened · share with the recipient</div>
            <ShareLink url={created.link} />
            <a className="mono" style={{ color: "var(--blue)", fontSize: 12 }} href={explorerObjectUrl(created.paycardId)} target="_blank" rel="noreferrer">view paycard in explorer →</a>
            <div className="actions-row">
              <button type="button" className="btn btn-ghost" onClick={() => lifecycle("claim")}>claim accrued</button>
              <button type="button" className="btn btn-ghost" onClick={() => lifecycle("cancel")}>{confirm === "cancel" ? "confirm cancel" : "cancel"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => lifecycle("resolve")}>{confirm === "resolve" ? "confirm resolve" : "resolve"}</button>
            </div>
            {confirm ? <div className="warn-row">⚠ irreversible on-chain settlement — pays accrued value and routes residual via STN-Delta.</div> : null}
          </div>
        ) : null}

        {invoice ? (
          <div>
            <div className="section-label">RailsFlow invoice · send to the payer to fund</div>
            <ShareLink url={invoice} />
            <div className="warn-row" style={{ background: "var(--blue-soft)", color: "oklch(0.46 0.16 252)" }}>
              no on-chain transaction yet — the channel mints when the payer opens this link and funds it.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
