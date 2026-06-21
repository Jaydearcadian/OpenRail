import { useEffect, useState } from "react";
import { useSuiClient } from "@mysten/dapp-kit";
import { useChannelWrite } from "../hooks/useChannelWrite";
import { ConnectMenu } from "../wallet/ConnectMenu";
import { explorerObjectUrl, explorerTxUrl } from "../config";
import { suiGlyph, humanRate, humanDuration, clockOf, shortId } from "../lib/format";
import { clearRailLocation, type FlowTerms, type RailTarget } from "../lib/raillink";
import { recordChannel } from "../lib/myChannels";

const STATUS_LABEL: Record<number, string> = { 0: "active", 2: "depleted", 3: "cancelled" };

interface PaycardView {
  payer: string;
  recipient: string;
  initialAllocation: string;
  poolValue: string;
  ratePerSec: string;
  startSec: number;
  durationSec: number;
  recovery: string;
  status: number;
}

function readPaycard(content: unknown): PaycardView | null {
  const fields = (content as { fields?: Record<string, unknown> })?.fields;
  if (!fields) return null;
  const pool = fields.allocation_pool as { fields?: { value?: string } } | string | undefined;
  const poolValue = typeof pool === "object" ? pool?.fields?.value ?? "0" : String(pool ?? "0");
  return {
    payer: String(fields.payer ?? ""),
    recipient: String(fields.recipient ?? ""),
    initialAllocation: String(fields.initial_allocation ?? "0"),
    poolValue,
    ratePerSec: String(fields.max_flow_rate_per_second ?? "0"),
    startSec: Number(fields.start_timestamp ?? 0),
    durationSec: Number(fields.duration_seconds ?? 0),
    recovery: String(fields.residual_delta_recipient ?? ""),
    status: Number(fields.status ?? 0),
  };
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="app grid-bg railview">
      <div className="railview-top">
        <button type="button" className="mono" onClick={() => { clearRailLocation(); window.location.reload(); }}>← OpenRails console</button>
        <ConnectMenu />
      </div>
      <div className="railview-body">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="rv-row"><span className="rv-k">{k}</span><span className="rv-v mono">{v}</span></div>;
}

function CardView({ paycardId }: { paycardId: string }) {
  const client = useSuiClient();
  const w = useChannelWrite();
  const [pc, setPc] = useState<PaycardView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await client.getObject({ id: paycardId, options: { showContent: true } });
      const view = readPaycard(res.data?.content);
      if (!view) { setErr("This RailsCard object was not found on this network."); setPc(null); }
      else setPc(view);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [paycardId]);

  const isRecipient = w.address && pc && w.address.toLowerCase() === pc.recipient.toLowerCase();
  const isPayer = w.address && pc && w.address.toLowerCase() === pc.payer.toLowerCase();
  const active = pc?.status === 0;
  const expired = !!pc && pc.startSec > 0 && Date.now() / 1000 > pc.startSec + pc.durationSec;
  const busy = ["pending-signature", "submitted", "finalizing"].includes(w.status.kind);

  const claim = async () => { recordChannel({ id: paycardId, role: "recipient", kind: "RailsCard" }); await w.claim(paycardId); await load(); };
  const settle = async (action: "cancel" | "resolve") => { await w[action](paycardId); await load(); };

  return (
    <div className="rv-card">
      <div className="rv-head">
        <span className="badge b-stream">RailsCard</span>
        <span className="mono mut">{shortId(paycardId, 8, 6)}</span>
      </div>
      <h2>You've been sent a streaming payment</h2>
      <p className="rv-sub">The payer has funded a bounded channel. Value accrues to the recipient over time; you claim what has streamed so far.</p>

      {loading ? <div className="rv-empty">loading channel…</div> : err ? <div className="status-line err">{err}</div> : pc ? (
        <>
          <div className="rv-rows">
            <Row k="status" v={<span className={`badge ${active ? "b-stream" : "b-settled"}`}>{STATUS_LABEL[pc.status] ?? pc.status}</span>} />
            <Row k="allocation" v={suiGlyph(pc.initialAllocation)} />
            <Row k="remaining in pool" v={suiGlyph(pc.poolValue)} />
            <Row k="flow rate" v={humanRate(pc.ratePerSec)} />
            <Row k="duration" v={humanDuration(pc.durationSec)} />
            <Row k="opened" v={clockOf(pc.startSec)} />
            <Row k="payer" v={shortId(pc.payer, 10, 8)} />
            <Row k="recipient" v={shortId(pc.recipient, 10, 8)} />
          </div>

          {!w.address ? (
            <div className="rv-cta"><p>Connect the recipient wallet to claim.</p><ConnectMenu /></div>
          ) : active && expired ? (
            <>
              <div className="status-line warn">stream window ended — settle to finalize (pays accrued to recipient, residual to recovery).</div>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => settle("resolve")}>settle (resolve) →</button>
            </>
          ) : isRecipient && active ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={claim}>claim what's streamed →</button>
          ) : isPayer && active ? (
            <div className="actions-row">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => settle("cancel")}>cancel (refund residual)</button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => settle("resolve")}>resolve & settle</button>
            </div>
          ) : !active ? (
            <div className="status-line ok">channel settled — see the receipt on the console.</div>
          ) : (
            <div className="status-line warn">connected wallet is neither payer nor recipient of this channel.</div>
          )}

          {w.status.kind === "confirmed" ? <div className="status-line ok">done · <a href={explorerTxUrl(w.status.digest)} target="_blank" rel="noreferrer">view tx →</a></div> : null}
          {w.status.kind === "failed" ? <div className="status-line err">failed: {w.status.message}</div> : null}
          {w.status.kind === "rejected" ? <div className="status-line warn">signature rejected</div> : null}

          <a className="mono rv-explorer" href={explorerObjectUrl(paycardId)} target="_blank" rel="noreferrer">view object in explorer →</a>
        </>
      ) : null}
    </div>
  );
}

function FlowView({ terms }: { terms: FlowTerms }) {
  const w = useChannelWrite();
  const [done, setDone] = useState<{ paycardId?: string; digest: string } | null>(null);
  const busy = ["pending-signature", "submitted", "finalizing"].includes(w.status.kind);

  const fund = async () => {
    const result = await w.open({
      amount: BigInt(terms.allocMist),
      rate: BigInt(terms.rateMist),
      recipient: terms.recipient,
      durationSeconds: terms.durationSec,
      recovery: terms.recovery,
    });
    if (result) {
      setDone(result);
      if (result.paycardId) recordChannel({ id: result.paycardId, role: "payer", kind: "RailsFlow" });
    }
  };

  return (
    <div className="rv-card">
      <div className="rv-head">
        <span className="badge b-stream">RailsFlow</span>
        {terms.memo ? <span className="mono mut">{terms.memo}</span> : null}
      </div>
      <h2>Payment requested</h2>
      <p className="rv-sub">A recipient has issued an invoice with signed terms. Funding it opens a bounded channel — they can only ever claim what streams over the duration; the rest is recoverable.</p>

      <div className="rv-rows">
        <Row k="you pay" v={suiGlyph(terms.allocMist)} />
        <Row k="flow rate" v={humanRate(terms.rateMist)} />
        <Row k="duration" v={humanDuration(terms.durationSec)} />
        <Row k="recipient" v={shortId(terms.recipient, 10, 8)} />
        <Row k="residual returns to" v={shortId(terms.recovery, 10, 8)} />
      </div>

      {done ? (
        <>
          <div className="status-line ok">funded · channel opened {done.paycardId ? shortId(done.paycardId, 8, 6) : ""} · <a href={explorerTxUrl(done.digest)} target="_blank" rel="noreferrer">view tx →</a></div>
          {done.paycardId ? <a className="mono rv-explorer" href={explorerObjectUrl(done.paycardId)} target="_blank" rel="noreferrer">view paycard in explorer →</a> : null}
        </>
      ) : !w.connected ? (
        <div className="rv-cta"><p>Connect a wallet to fund this invoice.</p><ConnectMenu /></div>
      ) : (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={fund}>{busy ? "funding…" : `fund invoice · ${suiGlyph(terms.allocMist)} →`}</button>
      )}

      {w.status.kind === "insufficient-balance" ? <div className="status-line warn">insufficient SUI to fund this invoice.</div> : null}
      {w.status.kind === "failed" ? <div className="status-line err">failed: {w.status.message}</div> : null}
      {w.status.kind === "rejected" ? <div className="status-line warn">signature rejected</div> : null}
    </div>
  );
}

export function RailView({ target }: { target: RailTarget }) {
  return (
    <Frame>
      {target.kind === "card" ? <CardView paycardId={target.paycardId} /> : <FlowView terms={target.terms} />}
    </Frame>
  );
}
