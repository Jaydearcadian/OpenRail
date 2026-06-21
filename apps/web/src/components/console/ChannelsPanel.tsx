import { useCallback, useEffect, useState } from "react";
import { useSuiClient } from "@mysten/dapp-kit";
import { useChannelWrite } from "../../hooks/useChannelWrite";
import { listChannels, forgetChannel, recordChannel, type MyChannelEntry } from "../../lib/myChannels";
import { fetchPaycard, fetchReceiptForPaycard, PAYCARD_STATUS, SETTLEMENT_TYPE, type PaycardView, type ReceiptView } from "../../lib/paycard";
import { suiGlyph, humanRate, humanDuration, clockOf, shortId } from "../../lib/format";
import { explorerObjectUrl, explorerTxUrl, OPENRAILS_PACKAGE_ID } from "../../config";
import { railCardUrl } from "../../lib/raillink";
import { ShareLink } from "./ShareLink";

interface Loaded {
  entry: MyChannelEntry;
  view: PaycardView | null;
  receipt?: ReceiptView | null;
  error?: string;
}

function ChannelCard({ loaded, onChanged }: { loaded: Loaded; onChanged: () => void }) {
  const w = useChannelWrite();
  const [confirm, setConfirm] = useState<"cancel" | "resolve" | null>(null);
  const [showShare, setShowShare] = useState(false);
  const { entry, view, error, receipt } = loaded;
  const busy = ["pending-signature", "submitted", "finalizing"].includes(w.status.kind);

  if (error || !view) {
    return (
      <div className="receipt-card">
        <div className="rc-head"><span className="badge b-mock">{entry.kind}</span><span className="mono mut">{shortId(entry.id, 8, 6)}</span></div>
        <p className="rc-sentence">{error ?? "Channel not found on this network."}</p>
        <div className="rc-actions"><button type="button" className="btn btn-ghost" onClick={() => { forgetChannel(entry.id); onChanged(); }}>remove</button></div>
      </div>
    );
  }

  const active = view.status === 0;
  const expired = view.startSec > 0 && Date.now() / 1000 > view.startSec + view.durationSec;
  const me = w.address?.toLowerCase();
  const isRecipient = me && me === view.recipient.toLowerCase();
  const isPayer = me && me === view.payer.toLowerCase();
  const pct = (() => {
    try {
      const init = Number(BigInt(view.initialAllocation));
      const pool = Number(BigInt(view.poolValue));
      return init > 0 ? Math.min(100, Math.round(((init - pool) / init) * 100)) : 0;
    } catch { return 0; }
  })();

  const act = async (action: "claim" | "cancel" | "resolve") => {
    if ((action === "cancel" || action === "resolve") && confirm !== action) { setConfirm(action); return; }
    setConfirm(null);
    await w[action](entry.id);
    onChanged();
  };

  return (
    <div className="receipt-card">
      <div className="rc-head">
        <span className={`badge ${active ? "b-stream" : "b-settled"}`}>{entry.kind} · {PAYCARD_STATUS[view.status] ?? view.status}</span>
        <a className="mono mut" href={explorerObjectUrl(entry.id)} target="_blank" rel="noreferrer">{shortId(entry.id, 8, 6)} ↗</a>
      </div>

      <div className="rc-flow">
        <div className="rc-party"><div className="rc-l">payer{isPayer ? " · you" : ""}</div><div className="rc-v mono">{shortId(view.payer, 8, 6)}</div></div>
        <div className="rc-arrow">
          <div className="rc-amount">{suiGlyph(view.initialAllocation)}</div>
          <div className="rc-bar"><i style={{ width: `${pct}%` }} /></div>
          <div className="rc-arrow-l">{pct}% drawn · pool {suiGlyph(view.poolValue)}</div>
        </div>
        <div className="rc-party"><div className="rc-l">recipient{isRecipient ? " · you" : ""}</div><div className="rc-v mono">{shortId(view.recipient, 8, 6)}</div></div>
      </div>

      <div className="rc-grid">
        <div><div className="rc-l">flow rate</div><div className="rc-v">{humanRate(view.ratePerSec)}</div></div>
        <div><div className="rc-l">duration</div><div className="rc-v">{humanDuration(view.durationSec)}</div></div>
        <div><div className="rc-l">opened</div><div className="rc-v">{view.startSec ? clockOf(view.startSec) : "at mint"}</div></div>
        <div><div className="rc-l">role</div><div className="rc-v">{entry.role}</div></div>
      </div>

      {active && expired ? (
        <div className="rc-actions">
          <div className="rc-conserve" style={{ background: "var(--amber-soft)", color: "oklch(0.5 0.12 60)", flex: 1 }}>stream window ended — settle to finalize</div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act("resolve")}>{confirm === "resolve" ? "confirm settle" : "settle (resolve)"}</button>
        </div>
      ) : active ? (
        <div className="rc-actions">
          {isRecipient ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act("claim")}>claim streamed</button> : null}
          {isPayer ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act("cancel")}>{confirm === "cancel" ? "confirm cancel" : "cancel"}</button> : null}
          {isPayer ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act("resolve")}>{confirm === "resolve" ? "confirm resolve" : "resolve"}</button> : null}
          {entry.kind === "RailsCard" ? <button type="button" className="btn btn-ghost" onClick={() => setShowShare((v) => !v)}>{showShare ? "hide link" : "share link"}</button> : null}
        </div>
      ) : receipt ? (
        <div className="settled-receipt">
          <div className="rc-l">terminal receipt · {SETTLEMENT_TYPE[receipt.settlementType] ?? receipt.settlementType}</div>
          <div className="sr-grid">
            <div><span>paid → recipient</span><b>{suiGlyph(receipt.paidMist)}</b></div>
            <div><span>residual → payer</span><b>{suiGlyph(receipt.residualMist)}</b></div>
            <div><span>allocation</span><b>{suiGlyph(receipt.initialMist)}</b></div>
          </div>
          <div className="rc-conserve ok">✓ conserved · also indexed to Receipts within ~5 min</div>
        </div>
      ) : (
        <div className="rc-conserve ok">settled — terminal receipt indexing (refresh shortly).</div>
      )}

      {w.status.kind === "confirmed" ? <div className="status-line ok" style={{ marginTop: 10 }}>done · <a href={explorerTxUrl(w.status.digest)} target="_blank" rel="noreferrer">view tx →</a></div> : null}
      {w.status.kind === "failed" ? <div className="status-line err" style={{ marginTop: 10 }}>failed: {w.status.message}</div> : null}
      {showShare ? <div style={{ marginTop: 12 }}><ShareLink url={railCardUrl(entry.id)} /></div> : null}
    </div>
  );
}

export function ChannelsPanel() {
  const client = useSuiClient();
  const [items, setItems] = useState<Loaded[] | null>(null);
  const [importId, setImportId] = useState("");

  const load = useCallback(async () => {
    const entries = listChannels();
    const loaded = await Promise.all(
      entries.map(async (entry): Promise<Loaded> => {
        try {
          const view = await fetchPaycard(client, entry.id);
          // Settled channel → read its terminal receipt straight from chain
          // (no dependency on the Worker's 5-min receipt indexer).
          const receipt = view && view.status !== 0
            ? await fetchReceiptForPaycard(client, OPENRAILS_PACKAGE_ID, entry.id)
            : null;
          return { entry, view, receipt };
        } catch (e) {
          return { entry, view: null, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    setItems(loaded);
  }, [client]);

  useEffect(() => { load(); }, [load]);

  const importChannel = () => {
    const id = importId.trim();
    if (!/^0x[0-9a-fA-F]+$/.test(id)) return;
    recordChannel({ id, role: "payer", kind: "RailsCard" });
    setImportId("");
    load();
  };

  return (
    <div className="panel">
      <div className="ph">
        <h3>◫ my channels</h3>
        <button type="button" className="act-link" onClick={load}>refresh</button>
      </div>
      <div className="pb">
        <p style={{ marginBottom: 14 }}>Channels you create or fund from this browser, read live from chain (independent of the gateway index).</p>

        <div className="import-row">
          <input value={importId} onChange={(e) => setImportId(e.target.value)} placeholder="import a paycard id (0x…)" className="mono" />
          <button type="button" className="btn btn-ghost" onClick={importChannel}>import</button>
        </div>

        {items === null ? (
          <div className="dt-empty">loading…</div>
        ) : items.length === 0 ? (
          <div className="dt-empty">no channels yet — create one in “create a rail”, or import a paycard id above.</div>
        ) : (
          <div className="channel-grid">
            {items.map((l) => <ChannelCard key={l.entry.id} loaded={l} onChanged={load} />)}
          </div>
        )}
      </div>
    </div>
  );
}
